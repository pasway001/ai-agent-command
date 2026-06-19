# Local Acceptance Report

Generated at: 2026-06-19T13:00:08.829Z

## Summary

- Passed: 21
- Warnings: 0
- Failures: 0
- Total checks: 21

## Checks

| Status | Check | Detail |
| --- | --- | --- |
| PASS | DB商品数 | 30 non-smoke product(s), stages={"scout":29,"lp":1} |
| PASS | スコア付き商品 | 30/30 products include shortlist.score |
| PASS | 一次ソースURL | 30/30 products include source URL |
| PASS | 次アクション | 30/30 products include next action |
| PASS | エージェント | 8 agent(s) seeded |
| PASS | 承認待ち | 30 open approval(s); can be lower after real review work |
| PASS | 実装ファイル src/app/(app)/sales/page.tsx | src/app/(app)/sales/page.tsx |
| PASS | 実装ファイル src/app/(app)/sales/actions.ts | src/app/(app)/sales/actions.ts |
| PASS | 実装ファイル src/lib/sales/execution.ts | src/lib/sales/execution.ts |
| PASS | 実装ファイル src/lib/sales/outreach-kit.ts | src/lib/sales/outreach-kit.ts |
| PASS | レポート scout-products-2026-06-19.json | reports/scout-products-2026-06-19.json (29689 bytes) |
| PASS | レポート sales-board-2026-06-19.csv | reports/sales-board-2026-06-19.csv (15602 bytes) |
| PASS | レポート sales-board-2026-06-19.md | reports/sales-board-2026-06-19.md (19817 bytes) |
| PASS | レポート outreach-kit-2026-06-19.csv | reports/outreach-kit-2026-06-19.csv (108252 bytes) |
| PASS | レポート outreach-kit-2026-06-19.md | reports/outreach-kit-2026-06-19.md (101229 bytes) |
| PASS | レポート sales-pack-2026-06-19.md | reports/sales-pack-2026-06-19.md (32400 bytes) |
| PASS | リサーチJSON | 30 researched item(s) |
| PASS | Sales Board CSV行数 | 30 data row(s) |
| PASS | Sales Board商談列 | rank,stage,status,title,score,sales_priority,category,target_retail_min_jpy,target_retail_max_jpy,target_landed_cost_max_jpy,gross_profit_at_min_jpy,gross_margin_pct,pse_check,giteki_check,food_sanitation_check,trademark_supplier_check,next_action,japan_angle,risks,source,source_url,lp_headline,lp_risk,lp_faq_count,lp_image_count,sales_status,supplier_email,next_follow_up_at,follow_up_state,sales_note |
| PASS | Outreach CSV行数 | 30 data row(s) |
| PASS | Outreachメール列 | rank,title,score,stage,source,source_url,contact_lookup_hint,next_action,required_checks,first_questions,ja_subject,ja_body,en_subject,en_body |
