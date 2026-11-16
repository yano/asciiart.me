# AA 用フォントの比較（開発用。GitHub には上げない）

fonts.aahub.org のフォント（GitHub の AAHub/fontbook と Codeberg の Saitamaar_Hasei から取得）を
Edge で表示して測る。結果のページは out/fontcmp/index.html。

1. `python aaeval/fontcmp/fontlab_make.py <フォントのフォルダ> <lab> <AA の html>...` … 測るページを作る
2. `python -I -m http.server 8770 --bind 127.0.0.1 --directory <lab>` … ページを配る
3. `node aaeval/fontcmp/fontlab_measure.mjs <lab>` … 送り幅、文字の形、AA の表示を撮る
4. `python aaeval/fontcmp/fontlab_analyze.py <lab>` … 幅の一致、行のずれ、濃さ
5. `python aaeval/fontcmp/fontlab_rematch.py <lab> 画像...` → `node aaeval/fontcmp/fontlab_shots2.mjs <lab>` … フォントの形で辞書を作り直して当てはめ、そのフォントで表示
6. `python aaeval/fontcmp/fontlab_page.py <lab> out/fontcmp` … 比較のページ

Edge の座標はエンジン（辞書）の座標より 1px 上（MS Pゴシックで確かめた）。fontlab_rematch はその分ずらして辞書にする。
