# CLAUDE.md — New-Game-by-Nakagawa（プードルとキャッチボール）

## これは何か
黒いミディアムプードルにボールを投げてキャッチしてもらうブラウザゲーム。外部ライブラリなし（`index.html` + `game.js` + `photo.js`）。
公開先は GitHub Pages: https://kazuya117.github.io/New-Game-by-Nakagawa/ （`main` に push すると 1〜2 分で反映。iPhone は Safari の「ホーム画面に追加」で起動できる）。
遊び方と得点の仕組みの正本は `README.md`。

## 作業場所（2026-10-21 以降）
- **編集は WSL 側のこの clone（`~/apps/New-Game-by-Nakagawa`）で行う。**
- 2026-09-21 に Windows 側 Claude Code（OneDrive 内 `ドキュメント/GitHub/New-Game-by-Nakagawa`）で一日で作った。OneDrive コピーは以後使わない。

## 決めたこと・事情
- 自分の犬の写真を登録すると頭だけ写真に差し替わる（体のアニメーションは共通）。写真は端末の localStorage にだけ保存し、repo にもサーバーにも送らない。登録が無ければ既定のプードル。
- 左へ走るときも写真は左右反転しない。くわえたボールは顔に重ならないようあごの端に置く。
- iPhone で音が出なかった件は、消音スイッチ対策（iOS 16.4 以降）とタップごとの音声再有効化で解決済み（中川さん実機で確認・2026-09-21）。
- 風は通しテスト後に少し弱めた。

## 動かし方（手元）
```bash
python3 -m http.server 8765   # ブラウザで http://localhost:8765/
```
`.claude/launch.json` も同じ設定（port 8765）。
