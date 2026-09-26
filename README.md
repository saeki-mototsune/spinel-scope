# spinel scope

**デモ: https://spinel-scope.mototsune.dev** | [English summary](README.en.md)

matz の Ruby AOT コンパイラ [**spinel**](https://github.com/matz/spinel) が Ruby プログラムを

**parse → 型推論 (analyze) → C 生成 (codegen) → コンパイル (cc) → 実行**

する過程を、ブラウザで段階ごとに観察できる学習用 Web サービス。

- 5 列パネル(Ruby / AST / 型情報 / 生成 C / 実行結果)+ ステージバー
- **クロスハイライト**: どのパネルの要素にホバーしても、対応する箇所が全パネルで同時に光る。Ruby の式には推論型と codegen の判断のツールチップ(例: `fib(n - 1)` → `Integer (int) · direct → fib`)、生成 C は `#line` を元に行単位で Ruby と対応
- 型情報パネルはメソッドのシグネチャ(RBS)・診断・呼び出しごとの codegen の判断(direct / switch / boxed、ブロックのインライン展開)・ノードごとの型を表示
- AST / 型情報 / C は整形表示と spinel の生の出力(`--dump-ast` のテキスト / `--emit-types` の JSON / `#line` 込みの C)を切替可能

## アーキテクチャ

parse / analyze / codegen は**ブラウザ内 WASM** で完結し、ネイティブの cc とバイナリ実行だけをサーバーに置くハイブリッド構成。サーバーに届くのは codegen が出力した C ソースのみで、任意の C が来る前提でサンドボックス側が全防御を担う。

spinel は 1 つの C バイナリ(`src/*.c` + libprism)で parse → 型推論 → C 生成までを 1 プロセスで行う。これを emscripten でそのまま 1 つの WASM にし、Worker 内で 2 回実行する(ステージバーの「analyze + codegen」が 1 チップなのはこのため)。

```
[ビルド時]
  spinel ソース(toolchain/spinel-src)+ patches/
    ├─ emcc → web/wasm/spinel.wasm   (コンパイラ全体 + libprism + builtins/*.rb 同梱)
    └─ cc   → libspinel_rt.a + build.env(--print-build の cc フラグ)→ サンドボックス

[ブラウザ (Web Worker 内で実行、js/spinel-runner.js)]
  Ruby 入力
    → spinel main.rb --dump-ast                 (SPINEL_EMIT_TYPES=1)
        → AST テキスト(全ノードに開始・終了位置)
    → spinel main.rb --emit-types -o types.json -S   (1 回のコンパイル)
        → 型情報 JSON(型付きノード / 診断 / codegen の判断)
        → シンボルマップ JSON(C 関数名 → Ruby メソッド名)
        → C ソース(stdout、#line 付き)
    → POST /api/compile_run

[サーバー]
  Sinatra API + 静的配信(レート制限付き)
    → リクエストごとに使い捨て Docker サンドボックスを起動
       (ネットワーク無し / read-only rootfs + tmpfs / 非 root /
        CPU 1core・メモリ 256MB・pids 制限 / 全体 15 秒タイムアウト)
    → cc -O2 + spinel の --print-build が示すフラグでコンパイル → 実行(10 秒制限)
    → {cc の stderr, stdout, exit code, 実行時間} を JSON で返す
```

### クロスハイライトの仕組み

spinel 自身の出力だけから `{nodeId → {rubyRange, type}}` / `{メソッド → {rubyRange, cRange}}` / `{C 行 → Ruby 行}` の索引を構築し(`web/js/mapping.js`)、全パネルはこの索引だけを参照する:

1. **Ruby ↔ AST** — `--dump-ast` の各ノードの位置(`node_line` / `node_col` / `node_end_line` / `node_end_col`。終了位置は `SPINEL_EMIT_TYPES=1` のとき出る)
2. **Ruby ↔ 型情報** — `--emit-types` の各レコード(位置 + ノード種別)を AST ノードと突き合わせる
3. **Ruby ↔ C** — 生成 C の `#line N "main.rb"` による行単位の対応と、`--emit-symbol-map`(C 関数名 → `Counter#increment` など)によるメソッド単位の対応

spinel は一部の構文糖衣(`map(&:to_s)`、`.send(:m, ...)`)をパース前にソース文字列として書き換えるため、その行の位置は書き換え後の文字列を指す。該当行は Ruby 側の対応付けを外し、Ruby パネルの見出しに通知を出す。また spinel は `3.times` などで使う組み込みメソッドの Ruby 実装(`builtins/*.rb`)をプログラムの前に展開するが、AST・型情報パネルではユーザーのプログラム部分だけを表示する。

### ディレクトリ構成

| パス | 役割 |
|---|---|
| `patches/` | spinel への最小パッチ(下記)。spinel 本体への変更はすべてここに集約 |
| `toolchain/` | spinel を emcc で 1 つの .wasm にビルドする Makefile(生成物は `web/wasm/`)。`spinel-src` は spinel のサブモジュール |
| `script/update-spinel` | spinel の版上げ(下記「spinel の更新」) |
| `web/` | ビルドレスの素の JS(ES Modules)。`js/spinel-runner.js` が WASM の実行、`js/worker.js` / `js/pipeline.js` が Worker 管理、`js/mapping.js` が索引構築、`js/panels/` が各パネル、`js/highlight.js` がハイライトの調停 |
| `server/` | Sinatra API(`app.rb`)+ サンドボックス起動(`sandbox_runner.rb`)+ レート制限(`rate_limiter.rb`)。`sandbox/` はサンドボックスの entry と `--print-build` → cc フラグ変換 |
| `Dockerfile` | 4 ステージ: native(パッチ済み spinel とランタイムのネイティブビルド)→ wasm → sandbox → app |
| `test/` | golden(WASM 版とネイティブ spinel の全出力 + 実行結果の一致)/ unit / E2E(Playwright)/ spike(採用しなかった構成の検証記録) |

## セットアップ

```bash
# 1. spinel ツールチェーン(サブモジュール取得 + パッチ + ネイティブビルド)
git submodule update --init --depth 1 toolchain/spinel-src
(cd toolchain/spinel-src && git apply ../../patches/*.patch)
make -C toolchain native     # make deps(prism / rbs 取得)+ bin/spinel + libspinel_rt.a

# 2. emsdk と WASM ビルド(バージョンは Dockerfile の emscripten/emsdk:6.0.5 に合わせる)
git clone https://github.com/emscripten-core/emsdk.git toolchain/emsdk
toolchain/emsdk/emsdk install 6.0.5 && toolchain/emsdk/emsdk activate 6.0.5
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
make -C toolchain golden                 # golden: WASM 版とネイティブ spinel の AST / 型情報 / シンボルマップ / C / 実行結果が一致(7 サンプル)
node --test test/unit/*.mjs              # mapping の単体テスト(ディレクトリ指定は node 25 で動かないためグロブ指定)
(cd server && bundle exec ruby -Itest test/api_test.rb)          # API
(cd server && bundle exec ruby -Itest test/rate_limiter_test.rb) # レート制限
(cd server && bundle exec ruby -Itest test/sandbox_runner_test.rb)
(cd server && bundle exec ruby -Itest test/api_golden_test.rb)   # API golden
(cd test/e2e && npx playwright test)     # E2E(サーバー自動起動)
```

CI(GitHub Actions)では、ツールチェーンのビルドや Docker を必要としない unit テストとレート制限テストのみを自動実行する。それ以外は上記コマンドでローカル実行する。

golden の期待値(`test/golden/expected/`)はパッチ済みネイティブ spinel の出力で、`test/golden/gen-expected.sh` で再生成する(組み込み `builtins/*.rb` のパスだけは `<builtins>/` に正規化)。

## spinel の更新

spinel はサブモジュール `toolchain/spinel-src` で特定のコミットに固定している(現在は upstream master の `246b5cb4`、リリース `2026.09.12` の 1158 コミット後)。upstream は `YYYY.MM.DD` 形式のリリースタグを打つので、版上げは原則タグ単位で行う:

```bash
script/update-spinel 2026.10.03     # タグ / コミット SHA / ブランチ名(master)を指定
script/update-spinel                # 省略時は最新のリリースタグ(現在の固定より古ければ中止)
make -C toolchain update-spinel REF=2026.10.03   # 同じもの
```

スクリプトは次を順に行い、失敗した時点でサブモジュールを REF のまま止める:

1. upstream を fetch して REF をチェックアウト(作業ツリーに当たっていたパッチは外してから)
2. `patches/*.patch` を順に `git apply --check` → 適用(当たらなければ該当パッチの更新が必要)
3. ネイティブビルド(`make -C toolchain native`)
4. WASM をクリーンビルド(`make -C toolchain`)
5. ネイティブ spinel で golden の期待値を再生成し、golden テスト(WASM 版との一致)と unit テストを実行

成功したら `git diff test/golden/expected` で spinel の出力の変化を確認し、`server/sandbox/build.sh` でサンドボックスを作り直して API / E2E テストを通してから、サブモジュール・`patches/`・期待値をまとめてコミットする。

パッチが当たらなくなったときは、upstream の該当箇所を読んでパッチを作り直す(サブモジュール内で修正 → `git -C toolchain/spinel-src diff` を元に `patches/` を更新)。upstream が同じ問題を直していればパッチごと削除する。`--dump-ast` / `--emit-types` / `--emit-symbol-map` の出力形式が変わった場合は `web/js/mapping.js` と unit テストの修正が必要になる(golden と unit テストがそれを検出する)。

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

すべて [patches/](patches/) に集約されている(upstream 提案可能な内容を意識して最小に保つ。各パッチの先頭に理由を記載):

1. **`0001-line-map-builtins-requires.patch`** — spinel がプログラムの先頭に自動挿入する `require "builtins/..."` 行を、行番号の対応表(ソース位置 → 元ファイルの行)が「ユーザーが書いた行」として数えてしまい、組み込みを展開したプログラムでは全ノードの行番号が展開ファイル数だけずれる(`--emit-types` / `--emit-symbol-map` / `#line` / エラーメッセージのすべて)。挿入した行数だけ対応表の開始を前にずらして直す。
2. **`0002-target-int-bits.patch`** — spinel は生成先の整数幅を自身のポインタ幅(と `cc` への問い合わせ)で決めるため、wasm32 でビルドしたコンパイラは 32 ビット向けの C を生成してしまう(サーバーの cc は 64 ビット)。ビルド時に `-DSP_TARGET_INT_BITS=64` で生成先の幅を指定できるようにする(未指定時の挙動は不変)。

以前の版で必要だった位置サイドカー出力とランタイムの Emscripten 対応は不要になった(位置は upstream の `--dump-ast` / `--emit-types` が出し、生成プログラムはサーバーでネイティブ実行するためランタイムを WASM 化しない)。シンボルマップはコンパイラ内部の環境変数 `SPINEL_PROFILE_SYMBOL_MAP`(`--profile` が使うもの)で型情報と同じ 1 回のコンパイルから取り出している。

## 既知の制限

- 入力できる Ruby は spinel がサポートするサブセットに限られる(spinel 本体の進捗に依存)
- spinel 同梱のパッケージ(`require "json"` など)は WASM 版に含めていないため、使うプログラムはコンパイルで拒否される
- spinel が構文糖衣を書き換える行(`&:sym`、`.send(:m)`)は Ruby パネル側の対応付けが外れる
- コンパイル + 実行はサンドボックス内で CPU 1 core / メモリ 256MB / 全体 15 秒(実行 10 秒)に制限され、ネットワークアクセスはできない
- `/api/compile_run` には IP ベースのレート制限がある
- ES Modules / Web Worker / WASM が動くモダンブラウザ前提(最新の Chrome / Firefox / Safari で動作確認)

## コントリビュート

Issue / PR を歓迎する。流儀は [CONTRIBUTING.md](CONTRIBUTING.md) を参照。脆弱性の報告は公開 Issue ではなく [SECURITY.md](SECURITY.md) の手順で。

## ライセンス

本リポジトリのコードは [MIT License](LICENSE)。

- [spinel](https://github.com/matz/spinel)(Yukihiro Matsumoto)は MIT License。本リポジトリは spinel のソースを同梱せず、サブモジュール(`toolchain/spinel-src`)として参照する。`patches/` は spinel のソースに対する差分であり、spinel と同じ MIT License に従う
- spinel が vendor する [prism](https://github.com/ruby/prism)(Shopify)も MIT License
- ビルド成果物(`web/wasm/spinel.{mjs,wasm}` およびデプロイイメージ)には spinel(`builtins/*.rb` を含む)/ prism 由来のコードが含まれる
