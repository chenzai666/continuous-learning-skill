# 自主学习技能 (Continuous Learning Skill) for OpenClaw

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen.svg)](https://nodejs.org/)
[![OpenClaw Skill](https://img.shields.io/badge/OpenClaw-Skill-blue.svg)](https://openclaw.ai)

**让 OpenClaw 具备自主学习能力，在四个维度上持续进化：**

1. **对话学习** — 从每次对话中提取偏好、习惯和决策模式
2. **笔记分析** — 分析 Obsidian 笔记，建立知识关联图谱
3. **行为观察** — 观察操作模式，识别高频任务和效率瓶颈
4. **网络聚合** — 定期搜索感兴趣的主题，自动整理存储内容

## ✨ 核心价值

- **个性化服务**：AI 越用越懂你，提供更精准的帮助
- **知识积累**：自动整理对话、笔记和网络内容，构建个人知识库
- **效率提升**：识别重复工作模式，提供自动化建议
- **持续进化**：AI 能力随时间增长，无需手动训练

## 🚀 快速开始

### 安装
```bash
# 克隆仓库
git clone https://github.com/chenzai666/continuous-learning-skill.git
cd continuous-learning-skill

# 安装依赖
npm install

# 初始化配置
node scripts/init-learning.mjs
```

### 最小配置
编辑 `~/.config/continuous-learning/config.json`：
```json
{
  "conversation_learning": {
    "enabled": true,
    "extract_facts": true,
    "update_memory_md": true
  },
  "llm": {
    "provider": "longcat",
    "model": "LongCat-Flash-Lite",
    "api_key": "your-longcat-api-key",
    "base_url": "https://api.longcat.chat/openai"
  }
}
```

### 运行测试
```bash
# 从 OpenClaw 会话历史提取学习点
node scripts/dialogue-learning.mjs --since "1h"

# 查看结果
cat ~/.openclaw/workspace/MEMORY.md | tail -20
```

## 📊 功能模块

### 1. 对话学习器 (dialogue-learning.mjs)
- ✅ 从 OpenClaw 会话历史文件读取真实对话
- ✅ 调用 LongCat LLM 提取偏好、习惯、决策
- ✅ 自动去重（基于 N-gram 相似度）
- ✅ 更新 MEMORY.md 和 Obsidian 笔记
- ✅ 支持从 memory/ 每日笔记学习

### 2. LLM 客户端 (llm-client.mjs)
- 支持 LongCat provider（320K 上下文）
- 支持 MiniMax / MiniMax 海外版
- 提供 `analyzeConversation()` 对话分析接口

### 3. 笔记分析器 (note-learning.mjs)
- 扫描 Obsidian vault 中的所有笔记
- 提取标签、链接、主题聚类
- 建立知识图谱，生成链接建议

### 4. 网络聚合器
- 使用 Tavily API 搜索高质量内容
- 按主题聚合网络信息
- 生成中文摘要，保存到 Obsidian

### 5. 行为观察器
- 记录 OpenClaw 命令使用情况
- 分析高频命令和工作流模式
- 提供自动化建议

## ⚙️ 配置说明

详细配置参考 [SETUP.md](SETUP.md)，包括：
- 系统要求和安装步骤
- 完整配置示例
- 环境变量设置
- 权限配置
- 自动化部署

### LLM 提供商配置

**LongCat（推荐）**
```json
{
  "provider": "longcat",
  "model": "LongCat-Flash-Lite",
  "api_key": "ak_your-key",
  "base_url": "https://api.longcat.chat/openai"
}
```

**MiniMax 国内版**
```json
{
  "provider": "minimax",
  "model": "MiniMax-M2.7-highspeed",
  "api_key": "sk-cp_your-key",
  "base_url": "https://api.minimaxi.com/anthropic/v1"
}
```

## 🧪 示例与测试

参考 [examples/](examples/) 目录：
- 示例会话数据
- 配置模板
- 自动化测试脚本
- 快速入门指南

运行测试：
```bash
./examples/run-test.sh
```

## 🔧 故障排除

常见问题参考 [SKILL.md](SKILL.md#troubleshooting)。

## 📈 路线图

### v1.1 (近期)
- [ ] Notion 集成支持
- [ ] 多语言支持
- [ ] 更智能的链接建议算法
- [ ] 可视化知识图谱

### v1.5 (中期)
- [ ] PDF/文档内容分析
- [ ] 跨设备学习同步
- [ ] 个性化模型微调
- [ ] 主动建议功能

## 🤝 贡献

欢迎提交 Issues 和 Pull Requests！

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。

## 📞 支持

- **文档**：[SKILL.md](SKILL.md)、[SETUP.md](SETUP.md)
- **中文文档**：[docs/](docs/)
- **示例**：[examples/](examples/)
- **问题反馈**：[GitHub Issues](https://github.com/chenzai666/continuous-learning-skill/issues)

---

**开始你的自主学习之旅！** 🚀

*最后更新：2026-04-13*  
*版本：1.1.0*
