# Web アプリの試験（開発用。GitHub には上げない）

ヘッドレスの Edge を DevTools プロトコルで動かす（Node 22 以降。追加のパッケージは不要）。
先に `python -m webapp.server --no-browser` を起動しておく（ポート 8765）。

- `node aaeval/webapp_test/ui_test.mjs <出力> <画像>` … 画像を入れる → 候補 → 調整 → 線画の下絵 → 増やす塗り → 等倍。画面の写真を撮る
- `node aaeval/webapp_test/ui_test2.mjs <出力> <画像>` … 書き出し（a.click を横取りして中身を保存）、減らす塗り、前の結果、塗りを戻す、黒い面、高密度、候補に戻す
- `python aaeval/webapp_test/check_canvas.py <出力> <AA の html>...` … aa.js の canvas 描画と Edge の MS Pゴシック表示を画素で比べる（全文字の行も自動で足す）
- `node aaeval/webapp_test/html_check.mjs <フォルダ> webapp/static/aa.js` … aa.js の toHtml と convert.to_html の一致（lines.json と py_*.html を用意する）
- `node aaeval/webapp_test/ui_test3.mjs <出力> <画像>` … 2026-11-15 の画面: 候補4つ（等倍で見比べ、位置を止める、←→）→ 大きさ（もっと大きく）→ 仕上げ。
  表示フォントの切り替え、行を直す（候補・マウスを置いて差し替え・Enter で確定）、テキストで直す、作り直しても直した行が残るか、1つ戻す、書き出しに直した行が入るか
- `node aaeval/webapp_test/ui_test4.mjs <出力> <画像>` … 2026-11-15（2回目）の画面: 0 前処理（切り抜き、AA の長辺、線の太さと
  おすすめ、線画で確かめる）→ 候補 → 大きさ → 仕上げの行を直す（横の伸び縮みの候補）→ 0 に戻って「前処理をしないで進む」。
  表示フォントの既定（Saitamaar）も見る
- `node aaeval/webapp_test/ui_test5.mjs <出力> <画像>` … 2026-11-15（3回目）の画面: 上の帯（手元で処理する旨、GitHub）、
  下絵の濃さの初期値、増やす・減らすの塗り重ね（段階、すぐ作り直す、4 回で止まる、送った塗りの値）、1つ戻す・やり直す
  （ボタンと Ctrl+Z / Ctrl+Y）、行の候補の並び、手直しを全て取り消す（確認の文、戻せるか）、.html の書き出し 2 種類。
  書き出した .html は出力フォルダに保存する（html_zoom.mjs で拡大してもずれないかを確かめられる）。
  4回目の感想で、行を直すときの帯（選んだ行は枠なし、マウスを置いた行は枠つき）も見る
- `node aaeval/webapp_test/ui_test6.mjs <出力> <画像>` … 2026-11-15（手順6の残り）の画面: 線画の手直し（線を消す・線を描き足す・点。
  送った直しの画像、線画の表示、AA の変化、1つ戻す・やり直す、下絵の線画、行の候補、全て取り消す、別の大きさでも残るか）と、
  使う文字（文字の画面、英数字といちばん多い文字を外す → AA・行の候補・1 の候補に出ないか、読み込み直しても覚えているか）
- `PYTHONPATH=. python aaeval/engine_test6.py [画像]` … エンジン側の線画の直し（edit）と、文字を外した辞書（GlyphSet.without）の確かめ
- `node aaeval/webapp_test/html_zoom.mjs <出力> <AA の html> [拡大率...]` … 書き出した .html（MS Pゴシック）を拡大率を変えて開き、
  行の右端が辞書の幅どおりかを測る（100% 以外ではずれる。2026-11-15 の記録）
- `node aaeval/webapp_test/font_offset.mjs <出力>` … 表示フォントで canvas に描いた AA と、ブラウザが文字として表示したものを撮る（縦位置の確認。比べ方は 2026-11-15 の記録では 5 フォントともずれ 0px）
- `node aaeval/webapp_test/i18n_test.mjs <出力> <画像> [--base URL]` … 英語の画面（?lang=en。ブラウザの中のエンジン）で、前処理 → 候補 →
  大きさ → 仕上げ → 行の候補 → 塗る・線画 → 使う文字まで進め、見えている文字と title に日本語が残っていないかを確かめる。
  途中で日本語に切り替えて英語に戻したあとも見る。各画面の写真を撮る（既定は build_static の serve.py、ポート 8765）
- `node aaeval/js/i18n_check.mjs` … 画面の英語（webapp/static/i18n_en.js）に足りない文・使っていない文が無いか（ブラウザは使わない）

ui_test.mjs と ui_test2.mjs は、候補が6つ・大きさを選ぶ手順が無かったころの画面用（いまの画面では動かない）。
ui_test3.mjs は 0 前処理を「前処理をしないで進む」で飛ばす。

ヘッドレスの Edge はダウンロードを保存しないので、書き出しは ui_test2 のやり方で確かめる。
画像は絶対パスで渡す（相対パスだと Edge がファイルを読めず、送るところで「Failed to fetch」になる）。
前の試験の Edge が残っているとポートが重なって止まる（プロファイルが edge-cdp-* の msedge を止める）。
起動して数秒すると Edge が同期の確認（edge://sync-confirmation-dialog/）を開き、試験のページが裏に回って描画が止まる
（画面の写真が 60 秒の時間切れになる）。`cdp.mjs` は同期を切り、開いた edge:// のページを閉じ続ける（2026-11-15）。
