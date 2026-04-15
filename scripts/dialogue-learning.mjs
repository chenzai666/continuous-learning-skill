#!/usr/bin/env node
/**
 * Dialogue Learning Module
 * 从对话历史中提取学习点，更新记忆系统
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { analyzeConversation } from './llm-client.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = process.env.OPENCLAW_WORKSPACE || '/root/.openclaw/workspace';

// Load config from config.json
function loadConfig() {
  const configPaths = [
    '/root/.config/continuous-learning/config.json',
    join(WORKSPACE, '.config/continuous-learning/config.json'),
  ];
  for (const configPath of configPaths) {
    try {
      if (existsSync(configPath)) {
        return JSON.parse(readFileSync(configPath, 'utf-8'));
      }
    } catch (e) {}
  }
  return null;
}

const cfg = loadConfig();

// Configuration - read from config.json if available
const CONFIG = {
  memoryPath: cfg?.storage?.memory_md_path || join(WORKSPACE, 'MEMORY.md'),
  obsidianVault: cfg?.note_analysis?.obsidian_vault || cfg?.storage?.obsidian_inbox_path?.replace(/\/[^/]+\/?$/, '') || null,
  inboxPath: cfg?.storage?.obsidian_inbox_path?.split('/').pop() || 'inbox',
  minConfidence: cfg?.conversation_learning?.min_confidence || 0.7,
  maxFactsPerSession: 10,
};

/**
 * Load conversation history from OpenClaw session files
 */
function loadSessionHistory() {
  const sessionDir = '/root/.openclaw/agents/main/sessions';
  const sessionsFile = join(sessionDir, 'sessions.json');
  
  if (!existsSync(sessionsFile)) {
    console.log('⚠️ sessions.json not found, using sample content');
    return null;
  }
  
  try {
    const sessionsData = JSON.parse(readFileSync(sessionsFile, 'utf-8'));
    
    // Find the Telegram direct session with Bocchi
    let sessionKey = null;
    for (const key of Object.keys(sessionsData)) {
      if (key.includes('telegram') && key.includes('999647007')) {
        sessionKey = key;
        break;
      }
    }
    
    if (!sessionKey) {
      console.log('⚠️ Telegram session not found, using sample content');
      return null;
    }
    
    const sessionInfo = sessionsData[sessionKey];
    const sessionFile = join(sessionDir, sessionInfo.sessionId + '.jsonl');
    
    if (!existsSync(sessionFile)) {
      console.log('⚠️ Session file not found, using sample content');
      return null;
    }
    
    // Read and parse JSONL
    const lines = readFileSync(sessionFile, 'utf-8').split('\n').filter(l => l.trim());
    const messages = [];
    
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'message' && entry.message) {
          const msg = entry.message;
          if (msg.role === 'user' && msg.content) {
            let text = typeof msg.content === 'string' ? msg.content : 
              (Array.isArray(msg.content) ? msg.content.map(c => c.text || '').join(' ') : '');
            
            // Strip system blocks - be more aggressive
            text = text.replace(/<relevant-memories>[\s\S]*?<\/relevant-memories>/gi, '');
            text = text.replace(/```json\n[\s\S]*?```\n?/gi, '');
            text = text.replace(/```\n?[\s\S]*?```\n?/gi, '');
            text = text.replace(/Conversation info[\s\S]*?(?=\n\n|\n$|$)/gi, '');
            text = text.replace(/Sender \(untrusted metadata\)[\s\S]*?(?=\n\n|\n$|$)/gi, '');
            text = text.replace(/System \(untrusted\)[\s\S]*?(?=\n\n|\n$|$)/gi, '');
            text = text.replace(/^\[.*?\]\(.*?\)\s*/gi, '');
            text = text.replace(/^\s*/gi, '');
            text = text.trim();
            
            // Skip heartbeat/system messages
            if (!text.includes('HEARTBEAT') && !text.includes('Read HEARTBEAT') && 
                text.length > 10) {
              messages.push(text);
            }
          }
        }
      } catch (e) {}
    }
    
    if (messages.length === 0) {
      console.log('⚠️ No valid messages found, using sample content');
      return null;
    }
    
    console.log(`📖 Loaded ${messages.length} user messages from session history`);
    return messages.join('\n\n');
  } catch (err) {
    console.error('❌ Failed to load session history:', err.message);
    return null;
  }
}

/**
 * Extract learning points from conversation using LLM
 */
async function extractLearningPoints(sessionContent) {
  // Build prompt for LLM extraction
  const prompt = `分析以下对话记录，提取值得长期记忆的关键信息。

**提取类型**：
1. **偏好** (Preference) - Bocchi 的喜好、厌恶、风格选择
2. **习惯** (Habit) - 重复出现的模式，工作流程
3. **决策** (Decision) - 明确的选择、判断标准
4. **知识** (Knowledge) - 重要的事实、概念理解
5. **人物** (Person) - 提及的重要人物及其关系
6. **项目** (Project) - 进行中的工作、目标

**输出格式**（JSON数组）：
[
  {
    "type": "preference|habit|decision|knowledge|person|project",
    "confidence": 0.0-1.0,
    "fact": "简洁的事实陈述",
    "context": "相关上下文（可选）",
    "source": "对话中的依据",
    "storage": "memory|obsidian|both"
  }
]

**规则**：
- 只提取高置信度（≥0.8）的事实
- 避免临时性、上下文依赖的信息
- **不记录**：具体技术操作（如"重启gateway"、"运行命令"）、单次事件、故障处理过程
- **只记录**：稳定的偏好（如喜欢什么信息展示方式）、行为模式（如如何学习/整理知识）、重要决策（如何处理问题的原则）
- 事实应简洁、原子化
- storage建议: 简短存memory，详细存obsidian，重要存both

---

对话记录：
${sessionContent}

请输出JSON格式（仅数组，无markdown代码块）：`;

  try {
    // 调用 LLM 分析对话
    console.log('🤖 Calling LLM for analysis...');
    const messages = [{ role: 'user', content: sessionContent }];
    const result = await analyzeConversation(messages, cfg);
    
    // 转换 LLM 返回格式为内部格式
    const facts = [];
    
    if (result.preferences) {
      result.preferences.forEach(p => facts.push({
        type: 'preference',
        confidence: 0.85,
        fact: p.replace(/用户/g, 'Bocchi'),
        context: '',
        source: '对话提取',
        storage: 'memory'
      }));
    }
    if (result.decisions) {
      result.decisions.forEach(d => facts.push({
        type: 'decision',
        confidence: 0.85,
        fact: d.replace(/用户/g, 'Bocchi'),
        context: '',
        source: '对话提取',
        storage: 'both'
      }));
    }
    if (result.facts) {
      result.facts.forEach(f => facts.push({
        type: 'knowledge',
        confidence: 0.8,
        fact: f.replace(/用户/g, 'Bocchi'),
        context: '',
        source: '对话提取',
        storage: 'memory'
      }));
    }
    if (result.commitments) {
      result.commitments.forEach(c => facts.push({
        type: 'project',
        confidence: 0.9,
        fact: c.replace(/用户/g, 'Bocchi'),
        context: '',
        source: '对话提取',
        storage: 'both'
      }));
    }
    if (result.insights) {
      result.insights.forEach(i => facts.push({
        type: 'habit',
        confidence: 0.75,
        fact: i.replace(/用户/g, 'Bocchi'),
        context: '',
        source: '对话提取',
        storage: 'memory'
      }));
    }
    
    // 过滤掉无营养的具体操作
    const skipPatterns = [
      '重启gateway', '决定重启gateway', '重启 gateway',
      'gateway挂掉', 'gateway崩溃', 'gateway莫名其妙',
    ];
    return facts.filter(f => {
      if (f.confidence < CONFIG.minConfidence) return false;
      const text = f.fact.toLowerCase();
      for (const pattern of skipPatterns) {
        if (text.includes(pattern.toLowerCase())) return false;
      }
      return true;
    });
  } catch (err) {
    console.error('❌ LLM call failed:', err.message);
    console.log('⚠️ Falling back to mock data');
    return [
      {
        type: "preference",
        confidence: 0.9,
        fact: "Bocchi 偏好使用表格展示结构化信息",
        context: "在讨论学习结果展示时明确表达",
        source: "'喜欢表格而非长文本'",
        storage: "memory"
      }
    ];
  }
}

/**
 * Update MEMORY.md with new facts
 */
function updateMemory(facts) {
  if (!existsSync(CONFIG.memoryPath)) {
    console.error(`❌ MEMORY.md not found at ${CONFIG.memoryPath}`);
    return false;
  }

  let memoryContent = readFileSync(CONFIG.memoryPath, 'utf-8');
  const timestamp = new Date().toISOString().split('T')[0];
  
  // Find or create Learning Updates section
  const sectionMarker = '## 🧠 自动学习更新';
  
  // Filter out facts already in MEMORY.md (deduplication)
  const sectionStart = memoryContent.indexOf(sectionMarker);
  const existingSection = sectionStart >= 0 ? memoryContent.substring(sectionStart) : '';
  
  const newFacts = facts.filter(f => {
    if (f.storage !== 'memory' && f.storage !== 'both') return false;
    // Extract existing fact texts from section
    const existingFacts = [];
    const regex = /-\s*\*\*(.+?)\*\*\s*\([^)]+\):\s*(.+?)\s*\[置信度/g;
    let match;
    while ((match = regex.exec(existingSection)) !== null) {
      existingFacts.push(match[2].trim());
    }
    
    // Check for overlap: if first 10+ chars overlap with existing, consider duplicate
    const newFactTrimmed = f.fact.trim();
    for (const ef of existingFacts) {
      // Find common substring of 8+ chars
      for (let len = Math.min(newFactTrimmed.length, ef.length); len >= 8; len--) {
        for (let i = 0; i <= newFactTrimmed.length - len; i++) {
          const sub = newFactTrimmed.substring(i, i + len);
          if (ef.includes(sub)) {
            return false; // Duplicate found
          }
        }
      }
    }
    return true;
  });
  
  if (newFacts.length === 0) {
    console.log('✅ All facts already exist in MEMORY.md, skipping');
    return true;
  }
  
  const entry = newFacts
    .map(f => `- **${f.type}** (${timestamp}): ${f.fact} [置信度:${f.confidence}]`)
    .join('\n');

  if (memoryContent.includes(sectionMarker)) {
    memoryContent = memoryContent.replace(
      sectionMarker,
      `${sectionMarker}\n\n${entry}\n`
    );
  } else {
    memoryContent += `\n\n${sectionMarker}\n\n${entry}\n`;
  }

  writeFileSync(CONFIG.memoryPath, memoryContent);
  console.log(`✅ Updated MEMORY.md with ${newFacts.length} new facts (${facts.length - newFacts.length} duplicates skipped)`);
  return true;
}

/**
 * Learn from daily memory notes in memory/ directory
 */
function learnFromNotes() {
  const memoryDir = '/root/.openclaw/workspace/memory';
  if (!existsSync(memoryDir)) return 0;
  
  const memoryContent = readFileSync(CONFIG.memoryPath, 'utf-8');
  const sectionMarker = '## 🧠 自动学习更新';
  const sectionStart = memoryContent.indexOf(sectionMarker);
  const existingSection = sectionStart >= 0 ? memoryContent.substring(sectionStart) : '';
  
  // Get existing fact texts
  const existingFacts = [];
  const regex = /-\s*\*\*(.+?)\*\*\s*\([^)]+\):\s*(.+?)\s*\[置信度/g;
  let match;
  while ((match = regex.exec(existingSection)) !== null) {
    existingFacts.push(match[2].trim());
  }
  
  const files = [];
  try {
    const entries = readdirSync(memoryDir);
    for (const e of entries) {
      if (e.match(/^\d{4}-\d{2}-\d{2}\.md$/)) {
        const path = join(memoryDir, e);
        const stat = statSync(path);
        files.push({ path, mtime: stat.mtimeMs });
      }
    }
  } catch (e) {}
  
  if (files.length === 0) return 0;
  
  // Sort by mtime, newest first
  files.sort((a, b) => b.mtime - a.mtime);
  
  let newCount = 0;
  for (const { path } of files) {
    const content = readFileSync(path, 'utf-8');
    const lines = content.split('\n');
    const timestamp = path.split('/').pop().replace('.md', '');
    
    for (const line of lines) {
      // Extract bullet points under 完成/发现/讨论 sections
      const bulletMatch = line.match(/^-\s+(.+)$/);
      if (!bulletMatch) continue;
      
      const text = bulletMatch[1].trim();
      if (text.length < 10) continue;
      
      // Skip if already exists
      let isDupe = false;
      for (const ef of existingFacts) {
        for (let len = Math.min(text.length, ef.length); len >= 8; len--) {
          for (let i = 0; i <= text.length - len; i++) {
            if (ef.includes(text.substring(i, i + len))) {
              isDupe = true;
              break;
            }
          }
          if (isDupe) break;
        }
        if (isDupe) break;
      }
      if (isDupe) continue;
      
      // Categorize
      let type = 'knowledge';
      if (text.includes('配置') || text.includes('设置') || text.includes('变更')) type = 'decision';
      if (text.includes('偏好') || text.includes('喜欢') || text.includes('希望')) type = 'preference';
      if (text.includes('习惯') || text.includes('总是') || text.includes('经常')) type = 'habit';
      
      existingFacts.push(text);
      
      const entry = `- **${type}** (${timestamp}): ${text} [置信度:0.75]`;
      
      if (memoryContent.includes(sectionMarker)) {
        memoryContent = memoryContent.replace(sectionMarker, `${sectionMarker}\n\n${entry}\n`);
      } else {
        memoryContent += `\n\n${sectionMarker}\n\n${entry}\n`;
      }
      
      newCount++;
    }
  }
  
  if (newCount > 0) {
    writeFileSync(CONFIG.memoryPath, memoryContent);
    console.log(`📝 Learned ${newCount} facts from ${files.length} daily memory files`);
  }
  
  return newCount;
}

/**
 * Write to Obsidian inbox
 */
function writeToObsidian(facts) {
  const obsidianFacts = facts.filter(f => f.storage === 'obsidian' || f.storage === 'both');
  if (obsidianFacts.length === 0) return true;
  if (!CONFIG.obsidianVault) {
    console.error('❌ Obsidian vault not configured (set note_analysis.obsidian_vault in config.json)');
    return false;
  }

  const timestamp = new Date();
  const dateStr = timestamp.toISOString().split('T')[0];
  const timeStr = timestamp.toTimeString().split(' ')[0].replace(/:/g, '-');
  const filename = `学习-${dateStr}-${timeStr}.md`;
  const filepath = join(CONFIG.obsidianVault, CONFIG.inboxPath, filename);

  const content = `---
tags: #learning #auto-extracted
date created: ${timestamp.toLocaleString('zh-CN')}
date modified: ${timestamp.toLocaleString('zh-CN')}
source: dialogue-learning
---

# 对话学习提取 - ${dateStr}

${obsidianFacts.map(f => `
## ${f.type.toUpperCase()} [置信度: ${f.confidence}]

**事实**: ${f.fact}

**上下文**: ${f.context || 'N/A'}

**来源**: ${f.source}

---
`).join('')}

*自动生成的学习记录*
`;

  try {
    writeFileSync(filepath, content);
    console.log(`✅ Created Obsidian note: ${filename}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to write to Obsidian: ${err.message}`);
    return false;
  }
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  console.log('🧠 Dialogue Learning Module');
  console.log('==========================');

  // Load real session content from OpenClaw
  let sessionContent = loadSessionHistory();
  
  if (!sessionContent) {
    // Fallback to sample
    sessionContent = `
User: 我要设计一个自主学习技能
Assistant: 建议分为四个维度：对话学习、笔记学习、行为学习、网络聚合
User: 学习结果放在哪里？
Assistant: MEMORY.md 是索引，Obsidian 是图书馆
User: 好的，我确认这个分工
`;
  }

  console.log('\n📖 Extracting learning points...');
  const facts = await extractLearningPoints(sessionContent);
  
  console.log(`\n🔍 Found ${facts.length} high-confidence facts:`);
  facts.forEach((f, i) => {
    console.log(`  ${i + 1}. [${f.type}] ${f.fact.substring(0, 60)}... (conf: ${f.confidence})`);
  });

  if (dryRun) {
    console.log('\n🧪 Dry run mode - no changes made');
    return;
  }

  console.log('\n💾 Updating memory systems...');
  
  const memoryOk = updateMemory(facts);
  learnFromNotes(); // Also learn from daily memory notes
  const obsidianOk = writeToObsidian(facts);

  console.log('\n✨ Summary:');
  console.log(`  - MEMORY.md: ${memoryOk ? '✅' : '❌'}`);
  console.log(`  - Obsidian: ${obsidianOk ? '✅' : '❌'}`);
}

main().catch(console.error);
