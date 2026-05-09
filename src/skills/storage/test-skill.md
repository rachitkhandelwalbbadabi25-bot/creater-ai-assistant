---
name: Test Skill
description: A safe skill to test the execution engine
triggers: [run test skill, execute test]
---

# Steps
1. system.info({})
2. fs.list_directory({ "path": "./" })
