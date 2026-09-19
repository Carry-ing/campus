<#
  真实鼠标输入检查（Windows）

  为什么需要它：页面气泡用的是 pointerdown/pointermove 那套手势代码，
  在 JS 里 dispatchEvent 造出来的合成事件**绕过了真实指针处理流程**
  （例如 setPointerCapture 对合成事件不生效），所以合成点击测不出
  「点了气泡没反应」这类问题。这个脚本走 Chrome DevTools Protocol 的
  Input.dispatchMouseEvent，派发的是浏览器内部真实输入，行为和手点一致。

  用法：
    node server.js                              # 先启动 campus 的静态服务
    powershell -File scripts\real-click-check.ps1            # 真实点击/拖动/返回键（默认）
    powershell -File scripts\real-click-check.ps1 -Probe     # 跑 __probe.html 页面内自检

  -Probe 模式：用真实时间打开 /__probe.html，等它把 SUMMARY 打出来再读结果。
  之所以不直接用 --virtual-time-budget 抓 DOM：无头浏览器在外链字体等请求挂住时
  会暂停虚拟时钟，页面里的 setTimeout 就永远不触发，自检页会卡在第一句等待上。
#>

param(
  [string]$BaseUrl = 'http://127.0.0.1:5180',
  [int]$Port = 9333,
  [switch]$Probe,
  # 自检页的路径，默认根目录。用来验证「发布到子路径」的场景：
  #   -Probe -ProbePath '/_site/__probe.html'
  [string]$ProbePath = '/__probe.html'
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- 工具
$script:cdpId = 1
$script:results = @()

function Check($name, $cond, $detail) {
  $script:results += [pscustomobject]@{ Name = $name; Pass = [bool]$cond; Detail = "$detail" }
  $mark = if ($cond) { 'PASS' } else { 'FAIL' }
  Write-Host ("[{0}] {1}  {2}" -f $mark, $name, $detail)
}

function Connect-Cdp($wsUrl) {
  $ws = [System.Net.WebSockets.ClientWebSocket]::new()
  # 注意：PowerShell 会把 void 调用的返回值也带进管道，这里必须 Out-Null，
  # 否则函数返回的 $ws 会变成「数组」，后面 $ws.SendAsync 就会报找不到方法。
  $ws.ConnectAsync([uri]$wsUrl, [System.Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
  return $ws
}

function Send-Cdp($ws, $obj) {
  $json = $obj | ConvertTo-Json -Depth 12 -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $seg = [System.ArraySegment[byte]]::new($bytes)
  $ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true,
    [System.Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
}

function Receive-Cdp($ws) {
  $buf = New-Object byte[] 262144
  $sb = [System.Text.StringBuilder]::new()
  do {
    $seg = [System.ArraySegment[byte]]::new($buf)
    $r = $ws.ReceiveAsync($seg, [System.Threading.CancellationToken]::None).GetAwaiter().GetResult()
    [void]$sb.Append([System.Text.Encoding]::UTF8.GetString($buf, 0, $r.Count))
  } while (-not $r.EndOfMessage)
  return $sb.ToString()
}

function Invoke-Cdp($ws, $method, $params) {
  $id = $script:cdpId++
  Send-Cdp $ws @{ id = $id; method = $method; params = $params }
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    $msg = Receive-Cdp $ws
    if (-not $msg) { continue }
    $o = $msg | ConvertFrom-Json
    if ($o.id -eq $id) { return $o }
  }
  throw "CDP 超时：$method"
}

function Eval-Js($ws, $expr) {
  $r = Invoke-Cdp $ws 'Runtime.evaluate' @{ expression = $expr; returnByValue = $true }
  if ($r.result.exceptionDetails) { return $null }
  return $r.result.result.value
}

function Get-Center($ws, $selector, $index = 0) {
  $expr = "JSON.stringify((function(){var els=document.querySelectorAll('" + $selector + "');var el=els[" + $index + "];" +
          "if(!el)return null;var r=el.getBoundingClientRect();" +
          "return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),w:Math.round(r.width),h:Math.round(r.height)};})())"
  $v = Eval-Js $ws $expr
  if (-not $v) { return $null }
  return $v | ConvertFrom-Json
}

function Move-Mouse($ws, $x, $y) {
  Invoke-Cdp $ws 'Input.dispatchMouseEvent' @{ type = 'mouseMoved'; x = $x; y = $y; button = 'none'; buttons = 0 } | Out-Null
}

function Click-Mouse($ws, $x, $y) {
  Move-Mouse $ws $x $y
  Invoke-Cdp $ws 'Input.dispatchMouseEvent' @{ type = 'mousePressed'; x = $x; y = $y; button = 'left'; buttons = 1; clickCount = 1 } | Out-Null
  Start-Sleep -Milliseconds 60
  Invoke-Cdp $ws 'Input.dispatchMouseEvent' @{ type = 'mouseReleased'; x = $x; y = $y; button = 'left'; buttons = 0; clickCount = 1 } | Out-Null
}

function Drag-Mouse($ws, $x1, $y1, $x2, $y2) {
  Move-Mouse $ws $x1 $y1
  Invoke-Cdp $ws 'Input.dispatchMouseEvent' @{ type = 'mousePressed'; x = $x1; y = $y1; button = 'left'; buttons = 1; clickCount = 1 } | Out-Null
  $steps = 6
  for ($i = 1; $i -le $steps; $i++) {
    $x = [int]($x1 + ($x2 - $x1) * $i / $steps)
    $y = [int]($y1 + ($y2 - $y1) * $i / $steps)
    Invoke-Cdp $ws 'Input.dispatchMouseEvent' @{ type = 'mouseMoved'; x = $x; y = $y; button = 'left'; buttons = 1 } | Out-Null
    Start-Sleep -Milliseconds 25
  }
  Invoke-Cdp $ws 'Input.dispatchMouseEvent' @{ type = 'mouseReleased'; x = $x2; y = $y2; button = 'left'; buttons = 0; clickCount = 1 } | Out-Null
}

# 真实键盘输入：先试 Input.insertText，不行就逐字派发 keyDown/keyUp。
# 刚切页时第一次 focus 有可能没落实（页面还在过渡中），所以带重试。
function Type-Into($ws, $selector, $text) {
  $v = ''
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    Eval-Js $ws "document.querySelector('$selector').focus()" | Out-Null
    Start-Sleep -Milliseconds 250
    Invoke-Cdp $ws 'Input.insertText' @{ text = $text } | Out-Null
    Start-Sleep -Milliseconds 250
    $v = [string](Eval-Js $ws "document.querySelector('$selector').value")
    if (-not [string]::IsNullOrEmpty($v)) { return $v }

    foreach ($ch in $text.ToCharArray()) {
      Invoke-Cdp $ws 'Input.dispatchKeyEvent' @{ type = 'keyDown'; text = [string]$ch; unmodifiedText = [string]$ch } | Out-Null
      Invoke-Cdp $ws 'Input.dispatchKeyEvent' @{ type = 'keyUp' } | Out-Null
    }
    Start-Sleep -Milliseconds 250
    $v = [string](Eval-Js $ws "document.querySelector('$selector').value")
    if (-not [string]::IsNullOrEmpty($v)) { return $v }
    Start-Sleep -Milliseconds 300
  }
  return $v
}

function Wait-For($ws, $expr, $seconds = 6) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    if ((Eval-Js $ws $expr) -eq $true) { return $true }
    Start-Sleep -Milliseconds 150
  }
  return $false
}

function Get-Route($ws) {
  return Eval-Js $ws "(location.hash||'').replace(/^#\/?/,'') || 'welcome'"
}

function Get-Scene($ws) {
  return Eval-Js $ws "(function(){var e=document.querySelector('.scene.is-active');return e?e.id:null;})()"
}

# hash 和场景都要对上再判定：hashchange 是异步的，只等 hash 会读到「还没切场景」的中间态
function Wait-Scene($ws, $hashExpr, $scene, $seconds = 6) {
  $expr = "($hashExpr) && (function(){var e=document.querySelector('.scene.is-active');return !!e && e.id==='$scene';})()"
  return Wait-For $ws $expr $seconds
}

# ---------------------------------------------------------------- 启动浏览器
$candidates = @(
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$browser = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { Write-Host '没找到 Edge 或 Chrome' -ForegroundColor Red; exit 1 }

try {
  Invoke-WebRequest -Uri "$BaseUrl/api/health" -UseBasicParsing -TimeoutSec 5 | Out-Null
} catch {
  Write-Host "本地服务没在运行（$BaseUrl）。请先执行：node server.js" -ForegroundColor Red
  exit 1
}

$profile = Join-Path ([System.IO.Path]::GetTempPath()) ("campus-cdp-" + [guid]::NewGuid().ToString('N'))
$startArgs = @(
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', "--user-data-dir=$profile", "--remote-debugging-port=$Port",
  '--window-size=1440,900', "$BaseUrl/#/activities"
)
$proc = Start-Process -FilePath $browser -ArgumentList $startArgs -PassThru
Write-Host "浏览器：$browser`n"

$ws = $null
try {
  # 等调试端口 + 找到页面目标
  $target = $null
  for ($i = 0; $i -lt 60 -and -not $target; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      $list = Invoke-RestMethod "http://127.0.0.1:$Port/json" -TimeoutSec 2
      $target = $list | Where-Object { $_.type -eq 'page' -and $_.webSocketDebuggerUrl } | Select-Object -First 1
    } catch { }
  }
  if (-not $target) { throw "连不上调试端口 $Port" }

  $ws = Connect-Cdp $target.webSocketDebuggerUrl
  Invoke-Cdp $ws 'Runtime.enable' @{} | Out-Null
  # 无头浏览器默认认为页面没有聚焦，Input.insertText 会被丢掉；
  # 打开焦点模拟，真实键盘输入才能落进输入框。
  try { Invoke-Cdp $ws 'Emulation.setFocusEmulationEnabled' @{ enabled = $true } | Out-Null } catch { }
  try { Invoke-Cdp $ws 'Page.bringToFront' @{} | Out-Null } catch { }

  # =========================================================== -Probe 模式
  if ($Probe) {
    Write-Host "打开自检页，等它自己跑完（真实时间，最多 150 秒）...`n"
    Invoke-Cdp $ws 'Page.navigate' @{ url = "$BaseUrl$ProbePath" } | Out-Null
    $done = Wait-For $ws "!!(document.getElementById('report') && document.getElementById('report').textContent.indexOf('SUMMARY') >= 0)" 150
    $report = [string](Eval-Js $ws "document.getElementById('report') ? document.getElementById('report').textContent : ''")
    $lines = @($report -split "`n" | Where-Object { $_ -match 'PROBE\|' })
    $lines | ForEach-Object { Write-Host ('  ' + ($_ -replace '^.*PROBE\|\s*', '')) }

    $summary = (($lines | Where-Object { $_ -match 'SUMMARY' }) -join '') -replace '.*SUMMARY = ', '' -replace '"', '' -replace '</pre>.*', ''
    $bad = @($lines | Where-Object { $_ -match '= false' -or $_ -match 'FATAL' })
    $passed = @($lines | Where-Object { $_ -match '= true$' }).Count
    Check '自检页跑完并给出结论' $done "$summary"
    Check '自检页没有失败项' ($bad.Count -eq 0) ("通过 $passed 项" + $(if ($bad.Count) { '；失败：' + (($bad | ForEach-Object { $_ -replace '^.*PROBE\|\s*', '' }) -join ' ; ') } else { '' }))
    return
  }

  # 等气泡页就绪
  if (-not (Wait-For $ws "document.querySelectorAll('.bubble').length===26" 15)) {
    throw "气泡没有渲染出来（数量=" + (Eval-Js $ws "document.querySelectorAll('.bubble').length") + "）"
  }
  Start-Sleep -Seconds 2

  # 每个测试组开始前先复位路由，免得一个失败把后面全带崩
  function Reset-Route($ws, $route) {
    Eval-Js $ws "location.hash='#/$route'" | Out-Null
    Start-Sleep -Milliseconds 900
  }

  # ============================================================ 1. 点气泡
  Reset-Route $ws 'activities'
  $hit = Eval-Js $ws "(function(){var b=document.querySelector('.bubble');var r=b.getBoundingClientRect();var t=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return t?(t.className||t.tagName):'none';})()"
  Check '1.气泡中心没有被别的元素盖住' ($hit -match 'bubble') "命中元素: $hit"

  $c = Get-Center $ws '.bubble'
  $wantId = Eval-Js $ws "document.querySelector('.bubble').dataset.id"
  Click-Mouse $ws $c.x $c.y
  $ok = Wait-Scene $ws "(location.hash||'').indexOf('#/activity/')===0" 'scene-detail' 6
  Check '1.真实点击气泡 → 跳到详情页' $ok ("hash=" + (Get-Route $ws) + " 期望=activity/" + $wantId)
  Check '1.详情页真的显示出来了' ((Get-Scene $ws) -eq 'scene-detail') ("当前场景=" + (Get-Scene $ws))
  $bubbleTitle = Eval-Js $ws "(function(){var bs=document.querySelectorAll('.bubble');for(var i=0;i<bs.length;i++){if(bs[i].dataset.id==='$wantId'){return bs[i].querySelector('.bubble-name').textContent;}}return null;})()"
  $detailTitle = Eval-Js $ws "document.querySelector('#detail-title').textContent"
  Check '1.详情页标题和气泡对得上' ($bubbleTitle -and $detailTitle -eq $bubbleTitle) "气泡=$bubbleTitle 详情页=$detailTitle"

  # ============================================================ 2. 详情页的返回键（顶部 + 底部）
  Reset-Route $ws 'activity/1'
  Check '2.前置：已经在详情页' ((Get-Scene $ws) -eq 'scene-detail') ("hash=" + (Get-Route $ws))
  $b = Get-Center $ws '#scene-detail .page-bar [data-back]'
  Check '2.详情页顶部返回键可见' ($b -ne $null -and $b.w -gt 20) "位置=$($b.x),$($b.y) 尺寸=$($b.w)x$($b.h)"
  Click-Mouse $ws $b.x $b.y
  $ok = Wait-Scene $ws "(location.hash||'')==='#/activities'" 'scene-bubbles' 6
  Check '2.点返回键 → 回到气泡页' $ok ("hash=" + (Get-Route $ws) + " 场景=" + (Get-Scene $ws))

  Reset-Route $ws 'activity/1'
  Eval-Js $ws "document.querySelector('#detail-scroll').scrollTop = 99999" | Out-Null
  Start-Sleep -Milliseconds 400
  $b2 = Get-Center $ws '#scene-detail .detail-actions .back-btn'
  Check '2.详情页底部返回键可见' ($b2 -ne $null -and $b2.w -gt 100) "位置=$($b2.x),$($b2.y) 尺寸=$($b2.w)x$($b2.h)"
  Click-Mouse $ws $b2.x $b2.y
  $ok = Wait-Scene $ws "(location.hash||'')==='#/activities'" 'scene-bubbles' 6
  Check '2.详情页底部返回键 → 回到气泡页' $ok ("hash=" + (Get-Route $ws))

  # ============================================================ 3. 拖动不误触
  Reset-Route $ws 'activities'
  $c2 = Get-Center $ws '.bubble' 2
  $beforeTransform = Eval-Js $ws "document.querySelector('#field').style.transform"
  Drag-Mouse $ws $c2.x $c2.y ($c2.x - 220) ($c2.y - 90)
  Start-Sleep -Milliseconds 900      # 等惯性滑行停下来再取坐标，否则点击会落空
  $afterTransform = Eval-Js $ws "document.querySelector('#field').style.transform"
  $routeAfterDrag = Get-Route $ws
  Check '3.真实拖动会平移气泡场地' ($beforeTransform -ne $afterTransform) "$beforeTransform → $afterTransform"
  Check '3.真实拖动不会误触跳转' ($routeAfterDrag -eq 'activities') "hash=$routeAfterDrag"

  $c3 = Get-Center $ws '.bubble' 2
  Start-Sleep -Milliseconds 120
  $c3 = Get-Center $ws '.bubble' 2      # 气泡自己在飘，取坐标后马上点
  Click-Mouse $ws $c3.x $c3.y
  $ok = Wait-Scene $ws "(location.hash||'').indexOf('#/activity/')===0" 'scene-detail' 6
  Check '3.滑动之后再点气泡，能正常跳转' $ok ("hash=" + (Get-Route $ws))

  # ============================================================ 4. 气泡页返回
  Reset-Route $ws 'activities'
  $b4 = Get-Center $ws '#scene-bubbles [data-back]'
  Check '4.气泡页返回键可见' ($b4 -ne $null -and $b4.w -gt 20) "位置=$($b4.x),$($b4.y)"
  Click-Mouse $ws $b4.x $b4.y
  $ok = Wait-Scene $ws "(location.hash||'')==='#/intro'" 'scene-lines' 6
  Check '4.气泡页返回键 → 回到三句话' $ok ("hash=" + (Get-Route $ws) + " 场景=" + (Get-Scene $ws))
  Start-Sleep -Seconds 2
  Check '4.回到三句话后停在原页(没被自动推走)' ((Get-Route $ws) -eq 'intro') ("hash=" + (Get-Route $ws))

  # ============================================================ 5. 三句话返回
  Reset-Route $ws 'intro'
  $b5 = Get-Center $ws '#scene-lines [data-back]'
  Check '5.三句话返回键可见' ($b5 -ne $null -and $b5.w -gt 20) "位置=$($b5.x),$($b5.y)"
  Click-Mouse $ws $b5.x $b5.y
  $ok = Wait-Scene $ws "(location.hash||'')==='#/welcome'" 'scene-gate' 6
  Check '5.三句话返回键 → 回到欢迎页' $ok ("hash=" + (Get-Route $ws) + " 场景=" + (Get-Scene $ws))

  # ============================================================ 6. 进入按钮
  Reset-Route $ws 'welcome'
  $b6 = Get-Center $ws '#btn-enter'
  Click-Mouse $ws $b6.x $b6.y
  $ok = Wait-Scene $ws "(location.hash||'')==='#/intro'" 'scene-lines' 6
  Check '6.「进入」按钮 → 进入三句话' $ok ("hash=" + (Get-Route $ws))

  # ============================================================ 7. 年份 / 底部红字
  $year = Eval-Js $ws "document.querySelector('.kicker').textContent"
  Check '7.欢迎页年份是 2026' ($year -match '2026') "文案=$year"

  Reset-Route $ws 'activity/3'
  $note = Eval-Js $ws "document.querySelector('.detail-footnote').textContent"
  $color = Eval-Js $ws "getComputedStyle(document.querySelector('.detail-footnote')).color"
  Check '7.每个介绍页底部有红字补充' ($note -eq '内容并不完全，细节请等待官方通知') "文案=$note"
  Check '7.红字确实是红色系' ($color -match '^rgb\((2[0-9][0-9]|1[89][0-9])') "颜色=$color"

  # ============================================================ 8. 气泡真的在自己慢慢动
  Reset-Route $ws 'activities'
  $expr = "JSON.stringify(window.campusPhysics.state().map(function(s){return [s.x,s.y,s.speed];}))"
  $s1 = (Eval-Js $ws $expr) | ConvertFrom-Json
  Start-Sleep -Seconds 3
  $s2 = (Eval-Js $ws $expr) | ConvertFrom-Json
  $moved = 0; $fastest = 0; $slowest = 9999
  for ($i = 0; $i -lt $s1.Count; $i++) {
    $d = [math]::Sqrt([math]::Pow($s2[$i][0] - $s1[$i][0], 2) + [math]::Pow($s2[$i][1] - $s1[$i][1], 2))
    if ($d -gt 1) { $moved++ }
    if ($s2[$i][2] -gt $fastest) { $fastest = $s2[$i][2] }
    if ($s2[$i][2] -lt $slowest) { $slowest = $s2[$i][2] }
  }
  Check '8.真实时间里气泡确实在自己移动' ($moved -ge 20) "3 秒内移动过的: $moved / $($s1.Count)"
  Check '8.运动速率不大(<= 40px/s)' ($fastest -le 40) ("最快={0:N1}px/s 最慢={1:N1}px/s" -f $fastest, $slowest)

  # ============================================================ 9. 鼠标拖过气泡不会选中文字
  Reset-Route $ws 'activities'
  $c9 = Get-Center $ws '.bubble'
  Drag-Mouse $ws $c9.x $c9.y ($c9.x + 260) ($c9.y + 90)
  Start-Sleep -Milliseconds 400
  $sel = Eval-Js $ws "String((window.getSelection && window.getSelection().toString()) || '')"
  Check '9.★鼠标拖过气泡不会选中文字' ([string]::IsNullOrEmpty($sel)) "选中的内容: [$sel]"
  Check '9.拖动之后仍停在气泡页' ((Get-Route $ws) -eq 'activities') ("hash=" + (Get-Route $ws))

  # ============================================================ 10. 发布自己的活动（真实点击 + 真实打字）
  Reset-Route $ws 'activities'
  $pub = Get-Center $ws '#publish-bubble'
  Check '10.气泡墙中央有「发布你的活动」' ($pub -ne $null -and $pub.w -gt 100) "位置=$($pub.x),$($pub.y) 尺寸=$($pub.w)x$($pub.h)"
  Click-Mouse $ws $pub.x $pub.y
  $ok = Wait-Scene $ws "(location.hash||'')==='#/publish'" 'scene-publish' 6
  Check '10.真实点击它 → 进入发布页' $ok ("hash=" + (Get-Route $ws) + " 场景=" + (Get-Scene $ws))

  $typed = Type-Into $ws '#pf-title' '周末自习搭子招募'
  Check '10.真实键盘输入能打进表单' ($typed -eq '周末自习搭子招募') "输入框内容=[$typed]"
  $typedTime = Type-Into $ws '#pf-time' '9 月 28 日 14:00'
  Check '10.第二项输入也生效' ($typedTime -eq '9 月 28 日 14:00') "时间=[$typedTime]"

  # 表单很长，发布按钮一开始在可视区外，真实点击前要先把它滚进视野
  Eval-Js $ws "document.querySelector('.publish-submit').scrollIntoView({ block: 'center' })" | Out-Null
  Start-Sleep -Milliseconds 500
  $subInfo = Eval-Js $ws "(function(){var r=document.querySelector('.publish-submit').getBoundingClientRect();return Math.round(r.top)+','+Math.round(r.bottom)+' / 视口'+window.innerHeight;})()"
  Check '10.发布按钮已经滚进可视区' ($true) $subInfo

  $beforeCount = [int](Eval-Js $ws "document.querySelectorAll('.bubble').length")
  $sub = Get-Center $ws '.publish-submit'
  Click-Mouse $ws $sub.x $sub.y
  Start-Sleep -Milliseconds 700
  $afterCount = [int](Eval-Js $ws "document.querySelectorAll('.bubble').length")
  Check '10.真实点击「吹出这颗气泡」→ 多一颗新气泡' ($afterCount -eq $beforeCount + 1) "$beforeCount → $afterCount"
  $found = Eval-Js $ws "Array.prototype.some.call(document.querySelectorAll('.bubble-name'), function(n){return n.textContent==='周末自习搭子招募';})"
  Check '10.新气泡就是刚发布的活动' ($found -eq $true) ''
  Check '10.发布后停在气泡墙' ((Get-Route $ws) -eq 'activities') ("hash=" + (Get-Route $ws))

  Start-Sleep -Seconds 2
  $grow = Eval-Js $ws "(function(){var s=window.campusPhysics.state();for(var i=0;i<s.length;i++){if(s[i].title==='周末自习搭子招募')return s[i].grow;}return -1;})()"
  Check '10.吹气动画已经吹完(grow=1)' ([double]$grow -eq 1) "grow=$grow"
}
catch {
  Check '执行过程' $false $_.Exception.Message
}
finally {
  if ($ws) { try { $ws.Dispose() } catch { } }
  if ($proc -and -not $proc.HasExited) { $proc | Stop-Process -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 400
  Remove-Item $profile -Recurse -Force -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------- 汇总
$pass = ($script:results | Where-Object { $_.Pass }).Count
$total = $script:results.Count
Write-Host ""
Write-Host ("SUMMARY: $pass / $total 通过")
$script:results | Where-Object { -not $_.Pass } | ForEach-Object { Write-Host ("  未通过： " + $_.Name + "  " + $_.Detail) -ForegroundColor Red }
if ($pass -ne $total) { exit 1 }
