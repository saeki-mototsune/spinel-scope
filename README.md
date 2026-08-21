# spinel visualize

**デモ: https://spinel-scope.mototsune.dev** | [English summary](README.en.md)

matz の Ruby AOT コンパイラ [**spinel**](https://github.com/matz/spinel) が Ruby プログラムを

**parse → 型推論 (analyze) → C 生成 (codegen) → コンパイル (cc) → 実行**

する過程を、ブラウザで段階ごとに観察できる学習用 Web サービス。

- 5 列パネル(Ruby / AST / 型推論 IR / 生成 C / 実行結果)+ ステージバー
- **クロスハイライト**: どのパネルの要素にホバーしても、対応する箇所が全パネルで同時に光る。Ruby の式には推論型のツールチップ(例: `fib(n - 1)` → `int`)
- AST / IR は整形表示と spinel の生の中間ファイル(.ast / .ir)を切替可能

## アーキテクチャ

parse / analyze / codegen は**ブラウザ内 WASM** で完結し、ネイティブの cc とバイナリ実行だけをサーバーに置くハイブリッド構成。サーバーに届くのは codegen が出力した C ソースのみで、任意の C が来る前提でサンドボックス側が全防御を担う。

```
[ビルド時]
  spinel ソース + patches/
    ├─ emcc → spinel_parse.wasm     (libprism + 位置サイドカーパッチ)
    ├─ emcc → spinel_analyze.wasm
    └─ emcc → spinel_codegen.wasm

[ブラウザ (Web Worker 内で実行)]
  Ruby 入力
    → spinel_parse.wasm    → AST テキスト + 位置マップ(サイドカー)
    → spinel_analyze.wasm  → IR テキスト(ノード単位の推論型キャッシュ含む)
    → spinel_codegen.wasm  → C ソース
    → POST /api/compile_run

[サーバー]
  Sinatra API + 静的配信(レート制限付き)
    → リクエストごとに使い捨て Docker サンドボックスを起動
       (ネットワーク無し / read-only rootfs + tmpfs / 非 root /
        CPU 1core・メモリ 256MB・pids 制限 / 全体 15 秒タイムアウト)
    → cc -O2 でコンパイル → 実行(10 秒制限)
    → {cc の stderr, stdout, exit code, 実行時間} を JSON で返す
```

### クロスハイライトの仕組み

3 種類のマッピングを合成して `{nodeId → {rubyRange, astLine, inferredType}}` などの索引を構築し、全パネルはこの索引だけを参照する:

1. **Ruby ↔ AST** — spinel へのパッチ(位置サイドカー)が出力する「ノード id → ソースオフセット範囲」
2. **Ruby ↔ 推論型 (IR)** — IR のノード単位推論型キャッシュを id で位置マップと結合
3. **Ruby ↔ C** — 生成 C の `sp_<メソッド名>` 命名規則によるメソッド粒度の対応付け

### ディレクトリ構成

| パス | 役割 |
|---|---|
| `patches/` | spinel への最小パッチ(位置サイドカー出力、emscripten 対応)。spinel 本体への変更はすべてここに集約 |
| `toolchain/` | spinel を emcc で 3 つの .wasm にビルドする Makefile(生成物は `web/wasm/`) |
| `web/` | ビルドレスの素の JS(ES Modules)。`js/pipeline.js` が Worker 管理、`js/mapping.js` が索引構築、`js/panels/` が各パネル、`js/highlight.js` がハイライトの調停 |
| `server/` | Sinatra API(`app.rb`)+ サンドボックス起動(`sandbox_runner.rb`)+ レート制限(`rate_limiter.rb`) |
| `Dockerfile` | 4 ステージ: bootstrap(spinel ネイティブビルド)→ wasm → sandbox → app |
| `test/` | golden(WASM 版とネイティブ spinel の全段出力一致)/ unit / E2E(Playwright)/ spike(採用しなかった構成の検証記録) |

## セットアップ

```bash
# 1. spinel ツールチェーン(サブモジュール取得 + パッチ + ネイティブビルド)
git submodule update --init --depth 1 toolchain/spinel-src
(cd toolchain/spinel-src && git apply ../../patches/*.patch && make deps && make)

# 2. emsdk と WASM ビルド(バージョンは Dockerfile の emscripten/emsdk:4.0.6 に合わせる)
git clone https://github.com/emscripten-core/emsdk.git toolchain/emsdk
toolchain/emsdk/emsdk install 4.0.6 && toolchain/emsdk/emsdk activate 4.0.6
make -C toolchain

# 3. サンドボックスイメージ
server/sandbox/build.sh

# 4. サーバー依存
(cd server && bundle install)
```

## 起動

```bash
cd server && bundle exec puma -p 9292
# → http://localhost:9292
```

## テスト

```bash
make -C toolchain golden                 # WASM ツールチェーン golden(6 サンプル全段一致)
node --test test/unit/*.mjs              # mapping の単体テスト(ディレクトリ指定は node 25 で動かないためグロブ指定)
(cd server && bundle exec ruby -Itest test/api_test.rb)          # API
(cd server && bundle exec ruby -Itest test/rate_limiter_test.rb) # レート制限
(cd server && bundle exec ruby -Itest test/sandbox_runner_test.rb)
(cd server && bundle exec ruby -Itest test/api_golden_test.rb)   # API golden
(cd test/e2e && npx playwright test)     # E2E(サーバー自動起動)
```

CI(GitHub Actions)では、ツールチェーンのビルドや Docker を必要としない unit テストとレート制限テストのみを自動実行する。それ以外は上記コマンドでローカル実行する。

## デプロイ (Kamal)

単一 VPS に Kamal 2 でデプロイする(VPS のアーキテクチャは `config/deploy.yml` の `builder.arch` で指定する。以下は amd64 VPS + arm64 Mac の例)。

```
Mac (arm64)                          VPS (amd64)
┌──────────────────┐                ┌───────────────────────────────┐
│ kamal deploy      │   GHCR 経由    │ kamal-proxy (TLS/Let's Encrypt)│
│ ├ app イメージ     │──── push ───▶ │   └▶ app コンテナ :9292        │
│ └ sandbox イメージ │   (SHA タグ)   │        │ /var/run/docker.sock │
│   (pre-deploy     │                │        ▼                      │
│    フックで push)  │                │   spinel-sandbox (使い捨て)    │
└──────────────────┘                └───────────────────────────────┘
```

kamal-proxy がドメインの TLS 終端と `/up` ヘルスチェックを担当する。app と
sandbox の 2 イメージは常に同じ git SHA タグで GHCR に置かれ、デプロイのたびに
pre-deploy フックが両者の一貫性を保証する(下記参照)。app コンテナはホストの
`/var/run/docker.sock` をマウントし、サンドボックスを隔離フラグ付きの兄弟コン
テナとして起動する。

環境固有の設定は gitignore された `config/deploy.yml` に置く:

```bash
cp config/deploy.yml.example config/deploy.yml
# <VPS_IP> / <APP_DOMAIN> / <GHCR_OWNER> を自分の環境に置き換える
```

前提:
- `gem install kamal`
- Docker Desktop(buildx。クロスビルドに使用)
- `git submodule update --init --depth 1 toolchain/spinel-src` 済み(WASM とサンドボックスをイメージ内でビルドするため)

```bash
export KAMAL_REGISTRY_PASSWORD=<GHCR PAT>
kamal setup      # 初回のみ: VPS への Docker 導入 + proxy 起動 + デプロイ
kamal deploy     # 以降のデプロイ(clean な git tree から)
```

デプロイのたびに pre-deploy フックが spinel-sandbox イメージを同じ git SHA で
build/push し、VPS に pull してから app が切り替わる(pull 失敗はデプロイ中断)。

運用:
- ログ: `kamal logs -f`
- ロールバック: `kamal app containers` で版確認 → `kamal rollback <version>`
- サンドボックス疎通: `kamal app exec 'docker info'`
- 古い sandbox イメージ掃除(直近 3 世代残す):
  `ssh <user>@<VPS_IP> 'docker images ghcr.io/<GHCR_OWNER>/spinel-sandbox --format "{{.Repository}}:{{.Tag}}" | tail -n +4 | xargs -r docker rmi'`

## spinel へのパッチ

すべて [patches/](patches/) に集約されている(upstream 提案可能な内容を意識して最小に保つ):

1. **`0001-parse-location-sidecar.patch`** — 環境変数 `SPINEL_AST_LOCATIONS=<file>` が設定されている時のみ、`<id> <開始オフセット> <終了オフセット>` をノード id ごとに指定ファイルへ出力する(AST テキスト形式自体は不変)。クロスハイライトの Ruby ↔ AST マッピングの元になる。
2. **`0002-runtime-wasm-support.patch`** — `sp_runtime.h` の Emscripten 対応。`__EMSCRIPTEN__` 時は ucontext を含めず Fiber を明示エラーのスタブに置換し、ラムダ用 arena(mmap)を縮小した遅延確保に変更する。

## 既知の制限

- 入力できる Ruby は spinel がサポートするサブセットに限られる(spinel 本体の進捗に依存)
- コンパイル + 実行はサンドボックス内で CPU 1 core / メモリ 256MB / 全体 15 秒(実行 10 秒)に制限され、ネットワークアクセスはできない
- `/api/compile_run` には IP ベースのレート制限がある
- ES Modules / Web Worker / WASM が動くモダンブラウザ前提(最新の Chrome / Firefox / Safari で動作確認)

## コントリビュート

Issue / PR を歓迎する。流儀は [CONTRIBUTING.md](CONTRIBUTING.md) を参照。脆弱性の報告は公開 Issue ではなく [SECURITY.md](SECURITY.md) の手順で。

## ライセンス

本リポジトリのコードは [MIT License](LICENSE)。

- [spinel](https://github.com/matz/spinel)(Yukihiro Matsumoto)は MIT License。本リポジトリは spinel のソースを同梱せず、サブモジュール(`toolchain/spinel-src`)として参照する。`patches/` は spinel のソースに対する差分であり、spinel と同じ MIT License に従う
- spinel が vendor する [prism](https://github.com/ruby/prism)(Shopify)も MIT License
- ビルド成果物(`web/wasm/*.wasm` およびデプロイイメージ)には spinel / prism 由来のコードが含まれる
