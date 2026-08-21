# Contributing

Issue / Pull Request を歓迎します。大きな変更の場合は、実装前に Issue で方針を相談してもらえるとスムーズです。

## 開発の流れ

1. [README のセットアップ](README.md#セットアップ)に従って環境を作る
2. 変更を加えたら、関連するテストを実行する([README のテスト節](README.md#テスト)参照)
   - CI では unit テストと rate limiter テストのみ自動実行されます。WASM ツールチェーンやサンドボックスに触れる変更は、ローカルで golden / API / E2E テストまで通してから PR してください
3. コミットメッセージは `fix:` / `feat:` / `docs:` などの [Conventional Commits](https://www.conventionalcommits.org/) 形式を推奨(必須ではありません)

## 方針

- spinel 本体への変更は本リポジトリでは受け付けません。パッチ(`patches/`)は upstream に提案可能な最小限の内容に保ちます
- セキュリティに関わる報告は Issue ではなく [SECURITY.md](SECURITY.md) の手順に従ってください

---

Issues and pull requests are welcome. For larger changes, please open an issue first to discuss the direction. CI only runs the unit and rate limiter tests; if your change touches the WASM toolchain or the sandbox, please run the golden / API / E2E tests locally before opening a PR (see the Testing section of the README).
