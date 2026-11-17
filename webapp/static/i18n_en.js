// 画面の英語（i18n.js）。キーは画面の日本語の文そのもの（{name} は埋める所、{n|単数|複数} は数で変わる語）。
// 日本語の文を変えたら、ここのキーも変える（aaeval/js/i18n_check.mjs で、足りないキーと使っていないキーを確かめる）。

// 画面の文（index.html と、t() で出す文）
export const EN = {
  // ---------- 上の帯 ----------
  "画像を AA に": "Turn pictures into AA",
  "画像を選ぶ": "Choose an image",
  "画像は、この PC で動いているこのアプリのサーバーにだけ渡します。インターネットには送りません。":
    "Your picture only goes to this app's server, running on this PC. It is never sent over the internet.",
  "画像は、このブラウザの中だけで処理します。インターネットには送りません（読み込むのはプログラムとモデルだけです）。":
    "Your picture is processed only inside this browser and is never sent over the internet (the app only downloads its program and models).",
  "画像は外部に送られません": "Your picture is never uploaded",
  "処理はすべて手元の PC の中": "Everything runs on your PC",
  "手順": "Steps",
  "0 前処理": "0 Prepare",
  "1 候補": "1 Candidates",
  "2 大きさ": "2 Size",
  "3 仕上げ": "3 Finish",
  "AA を表示するフォント。書き出す PNG もこのフォントで描きます": "The font used to show the AA. Exported PNGs use it too",
  "表示フォント": "Font",
  "使う文字": "Characters",
  "使う文字（{d}）": "Characters ({d})",
  "足した文字が {n} 文字あります: {chars}": "{n|character is|characters are} added: {chars}",
  "当てはめに使わない文字が {n} 文字あります: {chars}": "{n|character is|characters are} switched off: {chars}",
  "当てはめに使う文字を選びます（いまは辞書の文字をすべて使います）": "Choose the characters used for the AA (all of them are used now)",
  "GitHub のリポジトリ": "GitHub repository",

  // ---------- 状態 ----------
  "{s} 秒": "{s} s",
  "エラー: {msg}": "Error: {msg}",
  "作り直しています…": "Updating…",
  "作り直しました（{time}）": "Updated ({time})",
  "（初めはモデルの読み込みで 20 秒ほどかかります）": " (loading the models takes about 20 s the first time)",
  "（初めはモデル〈約 93MB〉を読み込みます。2 回目からはブラウザに残したものを使います）":
    " (the first time, the models are downloaded, about 93 MB; after that the browser keeps them)",
  "（初めはモデル〈約 88MB〉を読み込みます）": " (the first time, the model is downloaded, about 88 MB)",
  "線画化のモデル": "the line-art model",
  "色の境界のモデル": "the colour-edge model",
  "顔のモデル": "the face model",
  "背景を消すモデル": "the background-removal model",
  "{model}を読み込んでいます… {got} / {total} MB": "Downloading {model}… {got} / {total} MB",
  "{model}を準備しています…": "Preparing {model}…",
  "GPU で処理": "GPU",
  "CPU で処理（遅い）": "CPU (slow)",
  "CPU で処理（遅い、{n} スレッド）": "CPU (slow, {n} threads)",
  "画像の処理に、この PC の GPU を使っています（WebGPU）": "Pictures are processed on this PC's GPU (WebGPU)",
  "このブラウザでは GPU（WebGPU）が使えないので、CPU で処理しています。線画化に時間がかかります。Chrome か Edge の新しい版をおすすめします（Linux の Chrome は chrome://flags の「Unsafe WebGPU Support」を有効にすると GPU を使えることがあります）":
    "This browser cannot use the GPU (WebGPU), so pictures are processed on the CPU and the line art takes a while. A recent Chrome or Edge is recommended (on Linux, Chrome may use the GPU after you enable \"Unsafe WebGPU Support\" in chrome://flags)",
  "このブラウザでは GPU（WebGPU）が使えないので、CPU で動かします。線画化に数分かかります（Chrome か Edge の新しい版をおすすめします）":
    "This browser cannot use the GPU (WebGPU), so the app runs on the CPU and the line art takes a few minutes (a recent Chrome or Edge is recommended)",
  "候補を作っています… {done}/{total}{note}": "Making the candidates… {done}/{total}{note}",
  "候補ができました。気に入ったものの「これにする」を押してください": "The candidates are ready. Click \"Use this\" on the one you like",
  "大きさを変えて作っています… {done}/{total}": "Making other sizes… {done}/{total}",
  "できました。気に入った大きさの「これにする」を押してください": "Done. Click \"Use this\" on the size you like",

  // ---------- 画像を入れる ----------
  "ここに画像をドロップ": "Drop an image here",
  "または": "or",
  "ファイルを選ぶ": "choose a file",
  "、Ctrl+V で貼り付け": ", or paste it with Ctrl+V",
  "アニメ・イラスト向けです。切り抜きと大きさを決め（前処理）、設定の違う AA の候補から気に入ったものを選び、大きさを選んで、仕上げます。":
    "Made for anime-style pictures. Crop the picture and set the size (Prepare), pick the AA you like from candidates made with different settings, choose its size, then finish it.",
  "画像はインターネットに送られません。処理はすべて手元の PC の中で行います。大きな画像は長辺 2048px に縮めて使います。":
    "Your picture is never sent over the internet: everything runs on your PC. Large pictures are shrunk to 2048 px on the long side.",
  "画像のファイルを入れてください": "Please add an image file",
  "画像のファイルをドロップしてください": "Please drop an image file",
  "画像を読んでいます…": "Reading the picture…",
  "元の画像が読めませんでした": "Could not read the picture",
  "手直し（{what}）を外して、候補を作り直します。よろしいですか？": "This drops your touch-ups ({what}) and makes the candidates again. Continue?",
  "手で直した行 {n} 行": "{n|row|rows} fixed by hand",
  "塗った所": "painted areas",
  "線画の直し": "line-art fixes",

  // ---------- 0. 前処理 ----------
  "0. 前処理": "0. Prepare",
  "切り抜きと AA の大きさを決め、線の太さを確かめます。": "Crop the picture, set the AA size, and check the line width.",
  "次に画像を入れたときは、すぐに候補を作ります（上の「0 前処理」でいつでも戻れます）":
    "Next time, make the candidates right after a picture is added (you can always come back with \"0 Prepare\" above)",
  "次から飛ばす": "Skip next time",
  "前処理をしないで進む": "Skip this step",
  "この設定で候補を作る": "Make the candidates",
  "等倍で確かめる": "Check at 100%",
  "表示するもの": "What to show",
  "画像": "Picture",
  "線画": "Line art",
  "拡大": "Zoom",
  "等倍": "1×",
  "2倍": "2×",
  "切り抜き": "Crop",
  "左の画像をドラッグすると、その範囲を切り抜きます。枠の中をドラッグすると枠が動きます。":
    "Drag over the picture on the left to crop it. Drag inside the frame to move it.",
  "切り抜かない": "Don't crop",
  "背景": "Background",
  "残す": "Keep",
  "消す（白くする）": "Remove",
  "人物などを残して、背景を白にします（アニメ絵向けのモデル isnet-anime。写真にもある程度効きます）。背景の線が AA に出なくなります。":
    "Keeps the characters and turns the background white (isnet-anime, a model made for anime pictures; it also works fairly well on photos). Lines in the background then stay out of the AA.",
  "大きさ": "Size",
  "AA の長辺": "AA long side",
  "いつもの大きさ（長辺 800px まで）": "Default size (up to 800 px)",
  "線の太さ": "Line width",
  "太さを変える": "Change it",
  "おすすめにする": "Use the suggestion",
  "おすすめにする（{d}px）": "Use the suggestion ({d} px)",
  "おすすめ: 変えなくてよい": "Suggestion: no change needed",
  "変えない": "No change",
  "太すぎる線は AA で二重線になりやすく、細すぎる線は拾えないことがあります。太さは、明るい所・暗い所を広げて変えます（新しい線は描きません）。「線画」で、当てはめに使う線を確かめられます。":
    "Lines that are too thick tend to turn into double lines in the AA, and lines that are too thin may be missed. The width is changed by growing the light or the dark areas (no new lines are drawn). \"Line art\" shows the lines used for the AA.",
  "画像が大きいので、長辺 {max}px に縮めました（元は {w}×{h} px）。": "The picture was large, so it was shrunk to {max} px on the long side (it was {w}×{h} px). ",
  "切り抜きと大きさを決めて「この設定で候補を作る」を押してください。前処理しないで進むこともできます":
    "Crop the picture and set the size, then click \"Make the candidates\". You can also skip this step",
  "{w}×{h} px を切り抜きます（元は {W}×{H}）": "Cropping {w}×{h} px (out of {W}×{H})",
  "元の画像のまま（{W}×{H} px）": "Not cropped ({W}×{H} px)",
  "。送った画像（{w}×{h} px）は長辺 {max}px に縮めてあります": ". The picture ({w}×{h} px) was shrunk to {max} px on the long side",
  "ちょうどよい": "Good",
  "太い": "Thick",
  "細い": "Thin",
  "線が見つかりません": "No lines found",
  "AA: {w}×{h} px、{rows} 行。1 行は全角で約 {n} 文字ぶん。": "AA: {w}×{h} px, {rows|row|rows}. A row holds about {n} full-width characters. ",
  "画像の大きさのまま。": "The picture keeps its size.",
  "画像を ×{k} に縮めます。": "The picture is shrunk ×{k}.",
  "画像を ×{k} に拡大します。": "The picture is enlarged ×{k}.",
  "元の線の太さ: ": "Original line width: ",
  "線の太さ: ": "Line width: ",
  "約 {w}px": "about {w} px",
  " （測り直しています…）": " (measuring again…)",
  "目安 {a}〜{b}px（AA の大きさで）": "Good range: {a}–{b} px (at the AA size)",
  "線が太めです。AA で線が二重になる所が出るかもしれません。細くしてみてください。":
    "The lines are on the thick side, so some may turn into double lines in the AA. Try making them thinner.",
  "線が細めです。線を拾えない所が出るかもしれません。太くするか、AA を小さくしてみてください。":
    "The lines are on the thin side, so some may be missed. Try making them thicker, or making the AA smaller.",
  "線がほとんど見つかりませんでした。写真や、線の無い絵かもしれません。":
    "Hardly any lines were found. It may be a photo, or a picture without lines.",
  "変えたあと: ": "After the change: ",
  "背景を消して前処理しています…{note}": "Removing the background…{note}",
  "前処理しています…": "Preparing…",
  "前処理した画像を読んでいます…": "Reading the prepared picture…",
  "線画を作っています…{note}": "Making the line art…{note}",
  "前処理した画像が読めませんでした": "Could not read the prepared picture",
  "（当てはめに使う線）": " (the lines used for the AA)",

  // ---------- 1. 候補 / 2. 大きさ ----------
  "元の画像": "Original",
  "1. 候補を選ぶ": "1. Choose a candidate",
  "描き込みの少ない順に並んでいます。": "From the least detail to the most.",
  "2. 大きさを選ぶ": "2. Choose the size",
  "「{title}」を、大きさを少しずつ変えて作ります。大きさが変わると文字の並びも変わります。":
    "\"{title}\" at slightly different sizes. A change of size changes the glyph layout too.",
  "{w}×{h} px、{rows} 行": "{w}×{h} px, {rows|row|rows}",
  "もっと小さく": "Smaller",
  "もっと大きく": "Larger",
  "AA の長辺は {max}px までです。これより大きくはできません": "The AA can be at most {max} px on the long side, so it cannot be made larger",
  "図の上にマウス: その所を右に等倍で表示 ／ 図を押す: 位置を止める（もう一度押すと解除）／ 右の表示をつかんで動かす ／ ← →: 候補を切り替え ／ Enter: これにする":
    "Hover a picture: show that spot at 100% on the right / Click: hold the spot (click again to release) / Drag the view on the right to move it / ← →: switch candidates / Enter: use this",
  "押すと、マウスに合わせて動くようになります": "Click to follow the mouse again",
  "位置を止めています ✕": "Spot held ✕",
  "これにする": "Use this",
  "作っています…": "Making…",
  "手で直した行（{n} 行）を外して、この候補で仕上げを始めます。よろしいですか？（塗った所と線画の直しは残ります）":
    "This drops the {n|row|rows} you fixed by hand and starts finishing this AA. Continue? (Painted areas and line-art fixes are kept)",
  "仕上げの画面です。調整、行を直す、塗って描き込みを増やす・減らす、線画を直す、が使えます":
    "Finish the AA: change the settings, fix rows, paint for more or less detail, or fix the line art",

  // ---------- 3. 仕上げ ----------
  "もとの候補": "Base",
  "下絵": "Underlay",
  "下絵なし": "None",
  "下絵の濃さ": "Underlay opacity",
  "表示の大きさ": "View size",
  "全体（表示の大きさ）": "Fit",
  "押している間、作り直す前の AA を表示します": "Hold to show the AA from before the last change",
  "前の結果": "Previous",
  "テキスト（ここで直接直せます）": "Text (you can edit it here)",
  "調整": "Settings",
  "方式": "Method",
  "標準": "Standard",
  "高密度（太い線）": "High density",
  "描き込み": "Detail",
  "顔の描き込み": "Face detail",
  "色の境界": "Colour edges",
  "なし": "None",
  "顔": "Face",
  "全体": "All",
  "黒い面": "Dark areas",
  "面の濃さ": "Fill strength",
  "高密度は線を太らせて当てはめます。描き込み・顔・黒い面・塗りは使いません。":
    "High density thickens the lines before matching. Detail, face, dark areas and painting are not used.",
  "候補の設定に戻す": "Reset to the candidate's settings",
  "手直し": "Touch up",
  "手直しの道具": "Touch-up tools",
  "見るだけ": "View only",
  "行を直す": "Fix rows",
  "増やす": "More",
  "減らす": "Less",
  "線を消す": "Erase lines",
  "線を描き足す": "Draw lines",
  "AA の行を押すと、その行の別の候補が出ます。候補にマウスを置くと AA の中で差し替えて見せます。押して選び、「確定」で差し替えます（↑↓ で選ぶ、Enter で確定、Esc でやめる）。":
    "Click a row of the AA to get alternatives for it. Hover an alternative to preview it in the AA, click it to select it, then click \"Apply\" (↑↓ to select, Enter to apply, Esc to cancel).",
  "確定": "Apply",
  "やめる": "Cancel",
  "AA の下に、当てはめに使う線（赤）を出しています。": "The lines used for the AA are shown in red under the AA. ",
  "AA の上を塗ると、その所の描き込みが増え、すぐに作り直します。同じ所を塗り重ねるほど強く効きます（{n} 回まで）。ブラシの大きさは AA の 1 行ぶん弱です。":
    "Paint over the AA to add detail there; the AA is remade right away. Painting the same spot again makes it stronger (up to {n} times). The brush is a little under one AA row high.",
  "AA の上を塗ると、その所の描き込みが減り、すぐに作り直します。同じ所を塗り重ねるほど強く効きます（{n} 回まで）。ブラシの大きさは AA の 1 行ぶん弱です。":
    "Paint over the AA to reduce detail there; the AA is remade right away. Painting the same spot again makes it stronger (up to {n} times). The brush is a little under one AA row high.",
  "なぞった所に線を描き（緑）、すぐに作り直します。押すだけなら点になります（鼻や口の点に）。細かく描くときは「等倍」「2倍」で。":
    "Draw lines (green) and the AA is remade right away. A click makes a dot (for a nose or a mouth). Use \"1×\" or \"2×\" for fine work.",
  "なぞった所の線を消して（灰色）、すぐに作り直します。背景の線など、AA にしたくない線を消すのに使います。":
    "Erase lines (grey) and the AA is remade right away. Use it on lines you don't want in the AA, such as background lines.",
  "陰影": "Shading",
  "陰影の高密度": "Dense",
  "陰影の低密度": "Sparse",
  "文字": "Character",
  "塗り方": "Fill",
  "1行塗り": "One row",
  "バケツ塗り": "Bucket",
  "空白（薄い赤）を押すと、その行の空白を陰影の文字で埋めます。押したまま上下になぞると、なぞった行の空白をまとめて埋めます。":
    "Click a blank area (light red) to fill the blank in that row with shading characters. Drag up or down to fill the rows you pass over as well. ",
  "空白（薄い赤）を押すと、上下につながった空白をまとめて陰影の文字で埋めます（埋まる範囲は、マウスを置くと濃い赤で出ます）。":
    "Click a blank area (light red) to fill it and all the blank space connected above and below (hover to see it in dark red). ",
  "戻すときは「1つ戻す」で。": "Use \"Undo\" to take it back.",
  "空白（薄い赤の所）を押してください": "Click a blank area (the light red parts)",
  "陰影をつけました（{n} 行。Ctrl+Z で戻せます）": "Shading added ({n|row|rows}; Ctrl+Z to undo)",
  "1つ戻す": "Undo",
  "やり直す": "Redo",
  "手直しを全て取り消す": "Clear all touch-ups",
  "{w}×{h} px、{rows} 行、{chars} 文字": "{w}×{h} px, {rows|row|rows}, {chars|character|characters}",
  "、作成 {time}": ", made in {time}",
  "大きさ ×{k}": "Size ×{k}",
  "手で直した行が {n} 行あります（左の印）。設定を変えて作り直しても、その行はそのままです。":
    "{n|row was|rows were} fixed by hand (marked on the left). They stay as they are when the AA is remade.",
  "下絵が読めませんでした": "Could not read the underlay",
  "1つ戻しました（Ctrl+Y でやり直せます）": "Undone (Ctrl+Y to redo)",
  "やり直しました": "Redone",
  "手直し（{what}）を全て取り消して、エンジンの結果に戻します。よろしいですか？":
    "This clears all your touch-ups ({what}) and goes back to the engine's result. Continue?",
  "手直しを全て取り消しました（「1つ戻す」で元に戻せます）": "All touch-ups cleared (\"Undo\" brings them back)",
  "ここは、これ以上増やせません（{n} 回まで）": "This spot cannot get more detail (up to {n} times)",
  "ここは、これ以上減らせません（{n} 回まで）": "This spot cannot get less detail (up to {n} times)",
  "線画が読めませんでした": "Could not read the line art",
  "線を描き足しました（Ctrl+Z で戻せます）": "Line drawn (Ctrl+Z to undo)",
  "線を消しました（Ctrl+Z で戻せます）": "Line erased (Ctrl+Z to undo)",
  "行の候補を作っています…": "Making alternatives for the row…",
  "候補を作っています…": "Making alternatives…",
  "いまの行（手で直した行）": "Current row (fixed by hand)",
  "いまの行": "Current row",
  "直す前（エンジンの結果）": "Before your fix (engine result)",
  "{row} 行目の候補を {n} 個作りました（{time}）": "Made {n|alternative|alternatives} for row {row} ({time})",
  "{row} 行目を差し替えました（Ctrl+Z で戻せます）": "Row {row} replaced (Ctrl+Z to undo)",
  "{row} 行目": "Row {row}",
  "この行には、見た目の違う候補がありませんでした。": "No alternatives that look different were found for this row.",
  "別の並び": "Other glyphs",
  "横に伸び縮み（行の線の重心を中心に）": "Stretched or squeezed (around the middle of the row's lines)",
  "上下にずらす": "Shifted up or down",
  "設定を変える": "Other settings",
  "{row} 行目: 幅 {w} px（AA の幅 {W} px、MS Pゴシックで）": "Row {row}: {w} px wide (the AA is {W} px wide, in MS PGothic)",
  "。辞書に無い文字: {chars}": ". Not in the glyph table: {chars}",

  // ---------- 書き出す ----------
  "書き出す": "Export",
  "テキストをコピー": "Copy text",
  "MS Pゴシックで表示する .html（ブラウザのズームが 100% のときに、AA の文字の位置が合います）":
    "An .html shown in MS PGothic (the glyphs line up when the browser zoom is 100%)",
  ".html（フォント埋め込み）": ".html (font embedded)",
  ".html（{label} 埋め込み）": ".html ({label} embedded)",
  "AA に使う文字だけを {label} から抜き出して埋め込みます（{license}）。どの環境・ズームでも同じ見た目になります":
    "Embeds just the characters used in the AA, taken from {label} ({license}). It looks the same everywhere, at any zoom",
  "埋め込めるフォントがありません（python -m webapp.get_fonts で取ってきてください）":
    "No font to embed (get the fonts with python -m webapp.get_fonts)",
  ".html は MS Pゴシックで表示します（ブラウザのズームが 100% のときに位置が合います）。":
    ".html uses MS PGothic (the glyphs line up at 100% browser zoom). ",
  "埋め込みのほうは {label} で、どの環境・ズームでも同じ見た目です。": "The embedded one uses {label} and looks the same everywhere, at any zoom.",
  "{label} から AA に使う文字を抜き出しています…": "Taking the characters used in the AA from {label}…",
  "{label} を埋め込んだ .html を書き出しました（フォント {kb} KB）": "Saved the .html with {label} embedded (font: {kb} KB)",
  "テキストをコピーしました": "Text copied",
  "コピーできなかったので、下のテキストを選んであります。Ctrl+C でコピーしてください":
    "Could not copy, so the text below is selected. Press Ctrl+C to copy it",
  "文字の形: {label}（{license}）。AA に使う文字だけを埋め込んでいます": "Glyphs: {label} ({license}). Only the characters used in the AA are embedded",
  "文字の形: {label}（{license}、{source}）。AA に使う文字だけを埋め込んでいます":
    "Glyphs: {label} ({license}, {source}). Only the characters used in the AA are embedded",

  // ---------- 共有 ----------
  "共有": "Share",
  "共有…": "Share…",
  "この PC やスマホの共有の機能で、AA の画像と文を送ります（X のアプリなど）": "Send the AA image and a message with your device's share menu (the X app, for example)",
  "X に投稿": "Post on X",
  "AA の画像をコピーして、X の投稿の画面を開きます（画像は貼り付けて足します）": "Copies the AA image and opens X's post screen (paste the image there)",
  "共有用の画像を保存": "Save the image",
  "元の絵も並べる": "Show the original picture too",
  "元の絵を並べるのは、自分で描いた絵など、載せてよい絵のときだけにしてください。": "Only show the original picture if you may post it (your own drawing, for example).",
  "画像からAA（アスキーアート）を作りました。ブラウザだけで作れます → {url} #asciiartme #ASCIIArt #アスキーアート":
    "I made ASCII art (AA) from a picture. You can make one right in your browser → {url} #asciiartme #ASCIIArt",
  "投稿の文: {text}": "Message: {text}",
  "画像をコピーしました。開いた X の画面で貼り付けて（Ctrl+V）、画像を足してください": "The image is copied. Paste it (Ctrl+V) into the X screen that opened",
  "画像をコピーできませんでした。「共有用の画像を保存」で保存して、X の画面で画像を足してください":
    "Could not copy the image. Save it with \"Save the image\" and add it on the X screen",

  // ---------- 使う文字 ----------
  "閉じる": "Close",
  "文字を押すと、使う・使わないが切り替わります。外した文字（薄い赤）は AA に使いません（候補、大きさ、仕上げ、行の候補のすべて）。線の上に丸い文字が当たるときなどに外してください。選んだ文字はこのブラウザで覚えます。":
    "Click a character to switch it on or off. Characters switched off (light red) are not used in the AA (candidates, sizes, finishing and row alternatives). Switch off characters that keep turning up where they don't fit, such as round ones on straight lines. This browser remembers your choice.",
  "すべて使う": "Use all",
  "すべて外す": "Switch all off",
  "この文字で作り直す": "Remake with these",
  "使う文字を変えて作り直します（足した文字 {a}、外した文字 {n}）": "Remaking with the new characters ({a} added, {n} switched off)",
  "辞書の文字をすべて使って作り直します": "Remaking with all the characters",
  "{ch}（U+{code}、幅 {w}px）": "{ch} (U+{code}, {w} px wide)",
  "この AA で使っている文字（{n} 種類、多い順。数字は使っている数）": "Characters in this AA ({n} kinds, most used first; the numbers are counts)",
  "{on} / {total} 文字を使う": "{on} / {total} used",
  "{total} 文字のうち {used} 文字を使う（空白はいつも使います）": "{used} of {total} characters used (spaces are always used)",
  "足した文字": "Added",
  "辞書から消す": "Remove from the dictionary",
  "文字を足す": "Add characters",
  "足したい文字を打つか貼り付け": "Type or paste the characters to add",
  "足す": "Add",
  "文字を描くフォントを調べています…": "Checking the fonts…",
  "この PC では文字を足せません（MS Pゴシックも Saitamaar もありません）": "Characters cannot be added on this PC (neither MS PGothic nor Saitamaar is available)",
  "MS Pゴシックで形を描きます（辞書と同じ形になります）。": "The shapes are drawn with MS PGothic (the same as the dictionary).",
  "この PC には MS Pゴシックが無いので、Saitamaar で形を描きます（MS Pゴシックと幅が同じ文字だけ足せます）。":
    "This PC has no MS PGothic, so the shapes are drawn with Saitamaar (only characters as wide as in MS PGothic can be added).",
  "辞書にあります": "Already there",
  "MS Pゴシックに無い文字です": "Not in MS PGothic",
  "この PC では描けません": "Cannot draw it here",
  "幅 {w}px": "{w} px",
  "足せる文字は {n} 文字までです": "Up to {n} characters can be added",
  "辞書を保存": "Save the dictionary",
  "使う文字（足した文字を含み、外した文字を除く）を、辞書のファイル（標準の辞書と同じ形式）に保存します":
    "Saves the characters in use (with the added ones, without the switched-off ones) as a dictionary file (the same format as the standard dictionary)",
  "辞書を読み込む": "Load a dictionary",
  "保存した辞書のファイルを読みます。ファイルに無い文字は外し、標準の辞書に無い文字は足します":
    "Loads a saved dictionary file. Characters missing from the file are switched off, and characters not in the standard dictionary are added",
  "{n} 文字の辞書を保存しました": "Saved a dictionary of {n|character|characters}",
  "辞書のファイルとして読めませんでした": "This is not a dictionary file",
  "「{name}」を読みました（{n} 文字。足した文字 {a}、外した文字 {x}）。「この文字で作り直す」で使います":
    "Loaded \"{name}\" ({n|character|characters}: {a} added, {x} switched off). Click \"Remake with these\" to use it",
  "足せる文字の表が読めませんでした": "Could not load the table of characters that can be added",
  "文字を描くフォントがありません": "There is no font to draw the characters with",
  "記号": "Symbols",
  "半角カナ": "Half-width kana",
  "カタカナ": "Katakana",
  "ひらがな": "Hiragana",
  "英数字": "Letters and digits",
  "漢字": "Kanji",
  "ギリシャ・ロシア文字": "Greek and Cyrillic",

  // ---------- 表示フォント ----------
  "フォント「{label}」が読めなかったので、{fallback}で表示します（python -m webapp.get_fonts で取ってきてください）":
    "Could not load the font \"{label}\", so {fallback} is used (get the fonts with python -m webapp.get_fonts)",
  "表示フォント: {label}": "Font: {label}",
  "表示フォント: {label}（{license}）": "Font: {label} ({license})",

  // ---------- エンジン（ブラウザ） ----------
  "エンジンを動かせませんでした（{msg}）": "Could not start the engine ({msg})",
  "Worker のエラー": "Worker error",
  "文字の表を読めませんでした": "Could not load the glyph table",
  "そのフォントは埋め込めません": "That font cannot be embedded",
  "フォント「{label}」のファイルがありません": "The file of the font \"{label}\" is missing",
};

// エンジンやサーバー、fonts.json から来る文（tr() で訳す）
export const EN_ENGINE = {
  // 候補（webapp/server.py の WEB_PRESETS、aame/worker.js の PRESETS）
  "控えめ": "Sparse",
  "標準": "Standard",
  "色の境界": "Colour edges",
  "色の境界 + 黒い面": "Colour edges + dark areas",
  "標準より控えめ（線だけ、文字少なめ）": "Sparser than standard (lines only, fewer characters)",
  "標準: 線だけ": "Standard: lines only",
  "全体に色の境界を足す（髪のハイライト、影）": "Adds colour edges everywhere (hair highlights, shadows)",
  "全体の色の境界 + 黒い面を埋める": "Colour edges everywhere, and fills the dark areas",
  // 行の候補（aame/session.py、aame/session.js）
  "いまの設定のいちばん": "Best with the current settings",
  "標準（線だけ）": "Standard (lines only)",
  "多め": "More detail",
  "高密度": "High density",
  // エラー
  "文字の辞書を読めませんでした": "Could not load the glyph table",
  "画像が見つかりません（もう一度画像を入れてください）": "The picture was not found (please add it again)",
  "画像が見つかりません（サーバーを再起動したときは、もう一度画像を入れてください）":
    "The picture was not found (if the server was restarted, please add the picture again)",
  "大きさの倍率が範囲の外です": "The size factor is out of range",
  "画像として読めませんでした": "Could not read it as a picture",
  "画像が大きすぎます": "The picture is too large",
  "前処理した画像には、もう一度前処理できません": "A prepared picture cannot be prepared again",
  "前処理した画像には、もう一度前処理できません（元の画像の id を使ってください）": "A prepared picture cannot be prepared again (use the id of the original picture)",
  "切り抜く範囲が小さすぎます": "The crop is too small",
  "行の番号が範囲の外です": "The row number is out of range",
  "辞書がありません": "The glyph table is missing",
  "足した文字の辞書が読めませんでした": "Could not read the added characters",
  "辞書の形式ではありません": "This is not a dictionary file",
  // 表示フォント（fonts.json）
  "MS Pゴシック": "MS PGothic",
  "梅Pゴシック C4": "Ume P Gothic C4",
  "当てはめに使う形。文字の表（glyphs.json）で描くので、どの OS でも同じ見た目":
    "The shapes used for matching. Drawn from the glyph table (glyphs.json), so it looks the same on every OS",
  "幅は MS Pゴシックと同じ": "Same widths as MS PGothic",
  "IPA Pゴシックを AA 用に直したもの。幅が少し違う文字がある": "IPA PGothic adapted for AA. A few characters differ in width",
  "幅は MS Pゴシックと大きく違う": "Widths differ a lot from MS PGothic",
  "東雲・Kochi 代替が元。幅が少し違う文字がある": "Based on Shinonome and the Kochi substitute. A few characters differ in width",
  "梅フォントのライセンス（自由に利用・改変・再配布できる）": "Ume font licence (free to use, modify and redistribute)",
  "Apache License 2.0（もとのフォントのライセンスも同梱）": "Apache License 2.0 (the original fonts' licences are included)",
  "Public Domain（フォントの著作権表示に記載）": "Public Domain (as stated in the font's copyright notice)",
};

// 数などが入るエンジンの文（正規表現 → 英語。$1 などで埋める。関数のときは String.replace に渡す）
export const EN_PATTERNS = [
  [/^(\d+)番目$/, "#$1"],
  [/^足せる文字は (\d+) 文字までです$/, "Up to $1 characters can be added"],
  [/^上に (\d+)px$/, "Up $1 px"],
  [/^下に (\d+)px$/, "Down $1 px"],
  [/^([\d.]+)% 縮める$/, "$1% narrower"],
  [/^([\d.]+)% 広げる$/, "$1% wider"],
  [/^AA の長辺は (\d+)px までです$/, "The AA can be at most $1 px on the long side"],
  [/^AA の長辺は (\d+)〜(\d+)px です$/, "The AA long side must be $1–$2 px"],
  [/^設定 (\w+) が範囲の外です$/, "The setting $1 is out of range"],
  [/^モデル（(.+?)）を読めませんでした（(.*)）$/, "Could not download the model $1 ($2)"],
  [/^モデル（(.+?)）の中身が違います$/, "The model $1 is not the expected file"],
  [/^当てはめの Worker が止まりました（(.*)）$/, "A matching worker stopped ($1)"],
  [/^フォント「(.+)」のファイルがありません（python -m webapp.get_fonts で取ってきてください）$/,
    "The file of the font \"$1\" is missing (get the fonts with python -m webapp.get_fonts)"],
  [/^(.+)の画像が読めませんでした$/, (m, what) => `Could not read the ${EN[what] || what}`],   // 塗った所、線画の直し
];
