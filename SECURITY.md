# Security Policy

## 脆弱性の報告 / Reporting a Vulnerability

本サービスはユーザー由来の C ソースをサーバー側のサンドボックスでコンパイル・実行する設計のため、サンドボックス脱出やレート制限の回避などの報告を特に歓迎します。

脆弱性を発見した場合は、公開 Issue ではなく **GitHub の Private Vulnerability Reporting**([Security タブ → Report a vulnerability](../../security/advisories/new))から報告してください。

Please report vulnerabilities via GitHub's Private Vulnerability Reporting (Security tab → "Report a vulnerability") instead of opening a public issue. Reports about sandbox escapes or rate-limit bypasses are especially welcome, since this service compiles and runs user-supplied C in a server-side sandbox.

- 初回応答の目安: 7 日以内 / Initial response: within 7 days
- 修正が公開されるまで詳細の公開はお控えください / Please allow time for a fix before public disclosure
