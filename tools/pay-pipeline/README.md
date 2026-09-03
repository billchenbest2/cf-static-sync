# Pay Activities Pipeline (cf-static-sync)

每 5 天爬取行動支付活動 → AI 判讀 → 推送到 **CardSwitch** 的 `data/pay/`。

引擎在 `tools/pay-activities/`，排程：`.github/workflows/pay-activities-monthly.yml`。

## 排程（Asia/Taipei）

| 時間 |
|------|
| 每 5 天（1 / 6 / 11 / 16 / 21 / 26 日） 00:30 |

## 本機

```bash
cd tools/pay-activities && npm ci
export PAY_DATA_DIR=/path/to/CardSwitch-main/data/pay
export GEMINI_API_KEY=...
node ../pay-pipeline/run.mjs
```

## GitHub Secrets（填在 cf-static-sync 這個 repo）

| Secret | 必填 | 說明 |
|--------|------|------|
| `GEMINI_API_KEY` | 是 | Google AI Studio API Key |
| `CARDSWITCH_REPO` | 是 | 例如 `你的帳號/CardSwitch` |
| `PAYMENTMAPTW_APP_TOKEN` | 是（沿用既有） | 需對 CardSwitch 也有 Contents 寫入 |
| `TELEGRAM_BOT_TOKEN` | 否 | 失敗通知 |
| `TELEGRAM_CHAT_ID` | 否 | 失敗通知 |

不需新建 `CARDSWITCH_TOKEN`：workflow 直接使用已填的 `PAYMENTMAPTW_APP_TOKEN`。

請到該 Fine-grained PAT 設定，把 **CardSwitch** 勾進可存取 repo，並給 Contents **Read and write**。
