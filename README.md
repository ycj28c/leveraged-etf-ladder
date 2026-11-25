# 杠杆 ETF 阶梯加仓:回测与当前仓位

纯静态网页(无后端、无依赖):输入参数 → 回测 → 查看当前仓位与下一档建议。

> **免责声明**:仅为个人研究/学习工具,**不构成投资建议**。合成数据(1999 起)偏乐观;未计税、滑点、融资利差差异、做空/借券限制等;杠杆 ETF 可能出现 −80% 以上回撤。历史不代表未来。

## 策略规则

- 信号:QQQ 收盘价相对**冻结前高**的回撤(进入加仓状态后前高不更新)。
- 平常仓位默认:TQQQ 0 / 底仓(VOO 或 SPY)70 / QLD 15 / 现金 15。
- 阶梯(默认):−10% 卖底仓 1/10;−15% 底仓 1/4 + 现金 1/4;−20% 各 1/3;−25% 各 1/2;−30% 全部;均买入 TQQQ。
- TQQQ 上限只在**买入时**检查(上限 × 总资产 − 现有 TQQQ),上涨后超过上限不强制卖出。上限可为固定比例,或每年初按 `K ÷ 过去 252 日 QQQ 波动率` 计算(夹在上下限之间)。
- 回补:QQQ ≥ 前高 + (前高 − 谷底) 时,恢复平常仓位,TQQQ 清零,前高解冻。
- 外部资金(可选):回撤达到 −35/−40/−45/−50% 时各追加起始资金的 10%。收益用时间加权(TWR)与 IRR 报告。

## 数据与假设

- `data/prices.json`:QQQ、SPY、VOO、SPMO、QLD、TQQQ 的复权收盘价 + `^IRX`(13 周国债收益率),来自 Yahoo Finance 的**非官方**图表接口。
- 合成模式:TQQQ = 3×QQQ 日收益 − 2×国债日利率 − 年费 0.95%/252;QLD = 2× − 1×;底仓 = SPY;现金 = 国债。
- 回测按**收盘价**触发;实盘盘中触发会不同。
- **边界敏感**:回撤恰好卡在档位边缘时,复权价 ~1e-6 的噪声就可能让触发日改变(例如 2000-04-11 的 −15%),最终值可相差约 3%。不要拿不同次抓取的数据互相比较。

### 数据再分发注意

Yahoo 数据的服务条款可能不允许再分发。公开仓库前请自行确认;如有顾虑,可把 `data/prices.json` 加入 `.gitignore`,改为在 Actions 里构建时抓取并只部署到 Pages(仍属公开发布,需自行判断),或改用你有授权的数据源。

## 本地使用

```bash
python3 -I scripts/fetch_data.py        # 更新数据(标准库,无需 pip)
python3 -m http.server 8000             # 在项目根目录运行
# 打开 http://localhost:8000/web/
```

不能直接双击 html(浏览器会拦截 fetch 本地 json)。

## 测试

```bash
node tests/engine.test.js               # JS 引擎 vs 独立 Python 实现(同一份数据)
python3 -I tests/reference.py           # 数据更新后重新生成 tests/reference.json
```

每次更新数据后,合成用例的参考值可能因复权价噪声而变化,需重新运行 `reference.py`;因此测试**不放进**自动部署流程。

`tests/engine.test.js` 里的"真实 ETF"用例固定结束日 2026-11-17,不受之后数据更新影响;合成用例对照 `reference.json`。

## 部署到 GitHub Pages

1. 新建仓库,把本目录内容放进去并推送。
2. Settings → Pages → Source 选 **GitHub Actions**。
3. `.github/workflows/pages.yml` 会把 `web/` 和 `data/` 发布到站点根目录;`update-data.yml` 每个工作日抓取一次数据并提交(可在 Actions 页手动触发)。

## 目录

```
web/engine.js    策略引擎(浏览器/Node 通用)
web/app.js       界面
data/prices.json 数据
scripts/fetch_data.py
tests/
```
