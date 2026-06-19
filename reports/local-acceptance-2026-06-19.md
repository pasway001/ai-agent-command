# Local Acceptance Report

Generated at: 2026-06-19T13:23:55.851Z

## Summary

- Passed: 37
- Warnings: 0
- Failures: 0
- Total checks: 37

## Checks

| Status | Check | Detail |
| --- | --- | --- |
| PASS | DB商品数 | 35 non-smoke product(s), stages={"scout":34,"lp":1} |
| PASS | スコア付き商品 | 30/30 products include shortlist.score |
| PASS | 一次ソースURL | 32/30 products include source URL |
| PASS | 次アクション | 30/30 products include next action |
| PASS | 連絡先候補同期 | 30/30 products include synced contact leads |
| PASS | エージェント | 10 agent(s) seeded |
| PASS | 承認待ち | 32 open approval(s); can be lower after real review work |
| PASS | 最新Scout実行 | run=ed346d54-8568-49e8-97f2-2dcdb36591f2 scored=3 enqueued=2 errors=0 |
| PASS | 実装ファイル src/app/(app)/sales/page.tsx | src/app/(app)/sales/page.tsx |
| PASS | 実装ファイル src/app/(app)/sales/actions.ts | src/app/(app)/sales/actions.ts |
| PASS | 実装ファイル src/lib/sales/execution.ts | src/lib/sales/execution.ts |
| PASS | 実装ファイル src/lib/sales/tasks.ts | src/lib/sales/tasks.ts |
| PASS | 実装ファイル src/lib/sales/contact-leads.ts | src/lib/sales/contact-leads.ts |
| PASS | 実装ファイル src/lib/sales/contact-lead-fetch.ts | src/lib/sales/contact-lead-fetch.ts |
| PASS | 実装ファイル src/lib/sales/outreach-kit.ts | src/lib/sales/outreach-kit.ts |
| PASS | 実装ファイル scripts/export-sales-tasks.ts | scripts/export-sales-tasks.ts |
| PASS | 実装ファイル scripts/export-contact-leads.ts | scripts/export-contact-leads.ts |
| PASS | 実装ファイル scripts/sync-contact-leads.ts | scripts/sync-contact-leads.ts |
| PASS | レポート scout-products-2026-06-19.json | reports/scout-products-2026-06-19.json (29689 bytes) |
| PASS | レポート sales-board-2026-06-19.csv | reports/sales-board-2026-06-19.csv (15602 bytes) |
| PASS | レポート sales-board-2026-06-19.md | reports/sales-board-2026-06-19.md (19817 bytes) |
| PASS | レポート outreach-kit-2026-06-19.csv | reports/outreach-kit-2026-06-19.csv (108252 bytes) |
| PASS | レポート outreach-kit-2026-06-19.md | reports/outreach-kit-2026-06-19.md (101229 bytes) |
| PASS | レポート sales-tasks-2026-06-19.csv | reports/sales-tasks-2026-06-19.csv (31804 bytes) |
| PASS | レポート sales-tasks-2026-06-19.md | reports/sales-tasks-2026-06-19.md (35323 bytes) |
| PASS | レポート contact-leads-2026-06-19.csv | reports/contact-leads-2026-06-19.csv (30241 bytes) |
| PASS | レポート contact-leads-2026-06-19.md | reports/contact-leads-2026-06-19.md (35474 bytes) |
| PASS | レポート sales-pack-2026-06-19.md | reports/sales-pack-2026-06-19.md (32400 bytes) |
| PASS | リサーチJSON | 30 researched item(s) |
| PASS | Sales Board CSV行数 | 30 data row(s) |
| PASS | Sales Board商談列 | rank,stage,status,title,score,sales_priority,category,target_retail_min_jpy,target_retail_max_jpy,target_landed_cost_max_jpy,gross_profit_at_min_jpy,gross_margin_pct,pse_check,giteki_check,food_sanitation_check,trademark_supplier_check,next_action,japan_angle,risks,source,source_url,lp_headline,lp_risk,lp_faq_count,lp_image_count,sales_status,supplier_email,next_follow_up_at,follow_up_state,sales_note |
| PASS | Outreach CSV行数 | 30 data row(s) |
| PASS | Outreachメール列 | rank,title,score,stage,source,source_url,contact_lookup_hint,next_action,required_checks,first_questions,ja_subject,ja_body,en_subject,en_body |
| PASS | Sales Tasks CSV行数 | 30 data row(s) |
| PASS | Sales Tasks実行列 | rank,task_priority,task_type,task_action,title,score,sales_priority,stage,product_status,sales_status,follow_up_state,next_follow_up_at,supplier_email,contact_lookup_hint,source,source_url,next_action,japan_angle,required_checks,ja_subject,en_subject,sales_note |
| PASS | Contact Leads CSV行数 | 30 data row(s) |
| PASS | Contact Leads連絡先列 | rank,title,score,stage,source,source_url,fetch_status,primary_contact_type,primary_contact,emails,contact_pages,official_sites,crowdfunding_links,social_links,external_links,contact_lookup_hint,ja_subject,en_subject,next_action |
