# EmbeddedWebControlExperiments

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-live-brightgreen)](https://thewarrior-fan.github.io/EmbeddedWebControlExperiments/)

基于网页技术的控制系统仿真实验集合：用可交互的界面直观理解不同控制模型的工作原理与参数调节方法。

**纯前端实现** —— HTML5 + CSS3 + JavaScript + Canvas，无依赖、无构建、无后端，下载即可运行。

## 在线演示

<https://thewarrior-fan.github.io/EmbeddedWebControlExperiments/>

由 GitHub Pages 在每次推送 `main` 分支后自动部署。

## 快速开始

**方式一：直接打开**

双击 `pid-tuner.html`，用任意现代浏览器打开即可。

**方式二：本地静态服务**

```bash
python -m http.server 8000
# 浏览器访问 http://localhost:8000/pid-tuner.html
```

## 功能特性

- 实时水位仿真与可视化，目标水位可调
- Kp / Ki / Kd 滑块 + 微调按钮，参数改动即时生效
- Canvas 实时响应曲线，可暂停并拖动回看任意历史时段
- 理论稳态误差实时计算（含积分饱和情形）
- 状态读数：当前水位、阀门开度、误差、纯滞后帧数
- 一键整定与 P / PI / PID 三组实验预设

## 当前实验：PID 调参（`pid-tuner.html`）

**实验目的**：理解 PID 控制器的工作原理，掌握 Kp、Ki、Kd 对系统性能的影响。

**推荐调参顺序**

1. 先设 `Ki=0`、`Kd=0`，缓慢增大 `Kp`，直到出现轻微等幅振荡
2. 再增加 `Ki`，观察静差逐渐减小到消失
3. 最后增加 `Kd`，压低超调并缩短稳定时间

**预设参数与预期现象**（目标水位 0.6 m）

| 预设 | Kp | Ki | Kd | 现象 |
| --- | --- | --- | --- | --- |
| 默认（纯 P） | 15.0 | 0 | 0 | 稳定在 0.49，静差约 0.11 m |
| P 控制 | 50.0 | 0 | 0 | 轻微等幅振荡，振幅约 0.09 |
| PI 控制 | 20.0 | 2.0 | 0 | 静差归零，峰值约 0.70，约 13 s 稳定 |
| PID 控制 | 20.0 | 2.0 | 4.0 | 同上组仅加 D：峰值降到约 0.60，约 10 s 稳定 |

> `Kp ≥ 48` 左右进入持续振荡区，可用来演示临界比例增益。

**仿真模型**：水箱水位 = 阀门进水 − 与水位成正比的出水；过程增益约 0.3 m/%、主时间常数约 3.8 s，执行机构为一阶惯性，控制到测量之间有 16 帧（约 0.27 s）纯滞后。相关常量集中在 `pid-tuner.html` 顶部的 `const` 区，修改后请同步更新 [`实验介绍.md`](实验介绍.md) 中的数值。

## 目录结构

```
.
├── index.html       # GitHub Pages 入口（跳转到 pid-tuner.html）
├── pid-tuner.html   # PID 调参实验（单文件，HTML/CSS/JS 内联）
├── 实验介绍.md       # 实验系列的详细说明
├── README.md        # 本文件
├── LICENSE          # MIT
└── .gitignore
```

## 后续计划

- [ ] 模糊控制实验
- [ ] 自适应控制实验
- [ ] 更多被控对象模型（温度、转速等）

欢迎通过 Issue 和 PR 交流补充。

## 许可证

本项目采用 [MIT License](LICENSE) 开源。
