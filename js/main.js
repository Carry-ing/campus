/* =========================================================
   大学校园体验页 —— 交互逻辑
   界面 1 欢迎页 → 界面 2 三句话 → 界面 3 活动气泡 → 界面 4 活动详情页
   用 #/xxx 路由，所以浏览器的返回键、手机的返回手势也能用
   ========================================================= */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  var CATS = window.CAMPUS_CATS || {};
  var MY_KEY = 'campus.myActivities.v1';

  /* ---- 使用者自己发布的活动，存在本机浏览器里 ---- */
  function loadMyActivities() {
    try {
      var raw = window.localStorage.getItem(MY_KEY);
      var list = raw ? JSON.parse(raw) : [];
      if (Object.prototype.toString.call(list) !== '[object Array]') return [];
      return list.filter(function (a) { return a && a.id && a.title && a.facts; });
    } catch (err) {
      return [];    // 无痕模式 / 存储被禁时当作没有
    }
  }
  function saveMyActivities() {
    try { window.localStorage.setItem(MY_KEY, JSON.stringify(MY_ACTIVITIES)); } catch (err) { /* 忽略 */ }
  }

  var MY_ACTIVITIES = loadMyActivities();
  var ACTIVITIES = (window.CAMPUS_ACTIVITIES || []).concat(MY_ACTIVITIES);
  var TOTAL = ACTIVITIES.length;

  function refreshTotal() {
    TOTAL = ACTIVITIES.length;
    var el = $('#total');
    if (el) el.textContent = String(TOTAL);
    return TOTAL;
  }

  /* ---------------------------------------------------------
     背景星星
     --------------------------------------------------------- */
  (function buildStars() {
    var box = $('#stars');
    if (!box) return;
    var count = window.innerWidth < 700 ? 46 : 92;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < count; i++) {
      var s = document.createElement('span');
      var size = (1.6 + Math.random() * 2.4).toFixed(1);
      s.className = 'star';
      s.style.left = (Math.random() * 100).toFixed(2) + '%';
      s.style.top = (Math.random() * 100).toFixed(2) + '%';
      s.style.width = size + 'px';
      s.style.height = size + 'px';
      s.style.setProperty('--tw', (2.6 + Math.random() * 3.6).toFixed(2) + 's');
      s.style.setProperty('--twd', (Math.random() * 4).toFixed(2) + 's');
      frag.appendChild(s);
    }
    box.appendChild(frag);
  })();

  /* ---------------------------------------------------------
     场景切换
     --------------------------------------------------------- */
  var SCENES = ['scene-gate', 'scene-lines', 'scene-bubbles', 'scene-detail', 'scene-publish'];

  function setScene(id) {
    SCENES.forEach(function (sid) {
      var el = document.getElementById(sid);
      if (el) el.classList.toggle('is-active', sid === id);
    });
  }

  /* ---------------------------------------------------------
     路由：#/welcome  #/intro  #/activities  #/activity/<id>
     --------------------------------------------------------- */
  function currentRoute() {
    var h = (location.hash || '').replace(/^#\/?/, '');
    return h || 'welcome';
  }

  /** 跳到某个界面；hash 变了会走 hashchange，没变就直接渲染 */
  function go(route) {
    var target = '#/' + route;
    if (location.hash === target) applyRoute(route);
    else location.hash = target;
  }

  function applyRoute(route) {
    var m = /^activity\/(\d+)$/.exec(route);
    if (m) { enterDetail(Number(m[1])); return; }
    if (route === 'intro') { enterIntro(); return; }
    if (route === 'activities') { enterActivities(); return; }
    if (route === 'publish') { enterPublish(); return; }
    enterWelcome();
  }

  function enterWelcome() {
    stopLineTimers();
    setScene('scene-gate');
  }

  function enterIntro() {
    setScene('scene-lines');
    if (!introPassed) { introPassed = true; playLines(); }
    else { revealAllLines(); }   // 再次回到这一页：直接全部显示，不自动往前跳
  }

  function enterActivities() {
    stopLineTimers();
    // 已经走到这一页了，说明「三句话」这一关已经过掉；
    // 之后再用返回键回到那一页时，只静态显示三句话，不要又把用户自动推回这里
    introPassed = true;
    setScene('scene-bubbles');
    if (!bubblesStarted) { bubblesStarted = true; startBubbles(); }
    // 如果是在「还没建过气泡墙」的情况下发布的，就把刚发布的那颗吹出来
    if (pendingBlowId !== null) {
      var id = pendingBlowId;
      pendingBlowId = null;
      var body = findBody(id);
      if (body) blowUpBubble(body);
    }
    var hint = $('#foot-hint');
    if (hint) {
      clearTimeout(hintTimer);
      hintTimer = setTimeout(function () { hint.classList.add('is-faded'); }, 7000);
    }
  }

  function enterPublish() {
    stopLineTimers();
    buildPublishForm();
    setScene('scene-publish');
    var scroller = $('.publish-scroll');
    if (scroller) scroller.scrollTop = 0;
  }

  function enterDetail(id) {
    var act = null;
    for (var i = 0; i < ACTIVITIES.length; i++) {
      if (ACTIVITIES[i].id === id) { act = ACTIVITIES[i]; break; }
    }
    if (!act) { go('activities'); return; }

    renderDetail(act);
    setScene('scene-detail');
    markVisited(act.id);
  }

  /* ---------------------------------------------------------
     界面 2：三句话逐个出现
     --------------------------------------------------------- */
  var LINE_COLORS = ['#cfe0ff', '#ffd76e', '#7ef0d0'];
  var lineTimers = [];
  var introPassed = false;

  function stopLineTimers() {
    lineTimers.forEach(clearTimeout);
    lineTimers = [];
  }

  function sparkBurst(el, color) {
    if (!el) return;
    var scene = el.closest('.scene');
    if (!scene) return;
    var rect = el.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var frag = document.createDocumentFragment();
    var n = window.innerWidth < 700 ? 12 : 18;

    for (var i = 0; i < n; i++) {
      var p = document.createElement('span');
      var angle = (Math.PI * 2 * i) / n + Math.random() * 0.5;
      var dist = 70 + Math.random() * 170;
      p.className = 'spark';
      p.style.left = cx + 'px';
      p.style.top = cy + 'px';
      p.style.setProperty('--tx', (Math.cos(angle) * dist).toFixed(1) + 'px');
      p.style.setProperty('--ty', (Math.sin(angle) * dist * 0.72).toFixed(1) + 'px');
      p.style.setProperty('--sc', color);
      p.style.setProperty('--sd', (0.7 + Math.random() * 0.6).toFixed(2) + 's');
      frag.appendChild(p);
      (function (node) {
        setTimeout(function () { node.remove(); }, 1600);
      })(p);
    }
    scene.appendChild(frag);
  }

  function revealLine(index) {
    var el = $$('.line')[index];
    if (!el || el.classList.contains('is-show')) return;
    el.classList.add('is-show');
    sparkBurst(el, LINE_COLORS[index] || '#fff');
  }

  function revealAllLines() {
    stopLineTimers();
    for (var i = 0; i < 3; i++) revealLine(i);
  }

  function playLines() {
    stopLineTimers();
    $$('.line').forEach(function (el) { el.classList.remove('is-show'); });

    lineTimers.push(setTimeout(function () { revealLine(0); }, 500));
    lineTimers.push(setTimeout(function () { revealLine(1); }, 2100));
    lineTimers.push(setTimeout(function () { revealLine(2); }, 3700));
    lineTimers.push(setTimeout(function () { go('activities'); }, 6700));
  }

  function skipLines() {
    revealAllLines();
    lineTimers.push(setTimeout(function () { go('activities'); }, 800));
  }

  /* ---------------------------------------------------------
     界面 3：气泡
     --------------------------------------------------------- */
  var FIELD_W = 0;
  var FIELD_H = 0;
  var pan = { x: 0, y: 0 };
  var vel = { x: 0, y: 0 };
  var drag = { active: false, moved: false, lastX: 0, lastY: 0, startX: 0, startY: 0 };
  var glideRaf = 0;
  var bubblesStarted = false;
  var visited = Object.create(null);
  var visitedCount = 0;
  var toastTimer = 0;
  var hintTimer = 0;

  function axisClamp(v, screen, size) {
    if (size <= screen) return (screen - size) / 2;
    return Math.min(0, Math.max(screen - size, v));
  }

  function applyPan() {
    var wrap = $('#field-wrap');
    var field = $('#field');
    if (!wrap || !field) return;
    pan.x = axisClamp(pan.x, wrap.clientWidth, FIELD_W);
    pan.y = axisClamp(pan.y, wrap.clientHeight, FIELD_H);
    field.style.transform = 'translate3d(' + Math.round(pan.x) + 'px,' + Math.round(pan.y) + 'px,0)';
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  /* ---- 物理参数：慢慢飘 + 轻微碰撞挤压 ---- */
  var bodies = [];              // 每颗气泡：{holder, btn, nameEl, emojiEl, x, y, r, vx, vy, squash, axis}
  var publishBody = null;       // 正中央那颗「发布你的活动」
  var CELL_SIZE = 280;          // 网格边长，发布新气泡时要用
  var pendingBlowId = null;     // 气泡墙还没建过就发布了：进去之后补吹气动画
  var physRaf = 0;
  var physLast = 0;
  var collisionCount = 0;
  var SPEED_MIN = 9;            // 像素/秒，最慢也要一直在动
  var SPEED_MAX = 34;           // 像素/秒，别飘太快
  var WALL_DAMP = 0.94;         // 撞到场地边界的能量损失
  var RESTITUTION = 0.55;       // 碰撞弹性，越小越"闷"
  var SQUASH_MAX = 0.10;        // 最大挤压 10%，不夸张
  var physPaused = false;       // 自检/调试时可以关掉自动循环，改用手动 tick
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /** 估算名称字号：中文按 1 个字宽、字母数字按 0.55 个字宽算 */
  function nameFontGuess(title, size) {
    var units = 0;
    for (var i = 0; i < title.length; i++) {
      units += /[\x00-\xff]/.test(title.charAt(i)) ? 0.55 : 1;
    }
    var fs = size * 0.132;
    var perLine = Math.max(1, Math.round((size * 0.84) / fs));
    var lines = Math.ceil(units / perLine);
    if (lines > 3) fs = fs * 3 / lines;
    return Math.max(size * 0.072, Math.min(size * 0.15, fs));
  }

  /** 元素四角是否都在圆内（用布局值算，不受 transform 影响） */
  function cornersInsideCircle(child, size, limit) {
    var cx = size / 2;
    var cy = size / 2;
    var x0 = child.offsetLeft;
    var y0 = child.offsetTop;
    var xs = [x0, x0 + child.offsetWidth];
    var ys = [y0, y0 + child.offsetHeight];
    for (var i = 0; i < 2; i++) {
      for (var j = 0; j < 2; j++) {
        var dx = xs[i] - cx;
        var dy = ys[j] - cy;
        if (Math.sqrt(dx * dx + dy * dy) > limit) return false;
      }
    }
    return true;
  }

  /** 按标题长度自动缩字号，直到图标和整段名称都在圆内（这是"文字要全显示"的保证） */
  function fitBubbleText(body) {
    var size = body.r * 2;
    var limit = body.r * 0.95;
    var fs = nameFontGuess(body.title, size);
    body.nameEl.style.fontSize = fs.toFixed(2) + 'px';
    body.emojiEl.style.fontSize = (size * 0.19).toFixed(2) + 'px';

    for (var k = 0; k < 16; k++) {
      if (cornersInsideCircle(body.nameEl, size, limit) &&
          cornersInsideCircle(body.emojiEl, size, limit)) {
        return;
      }
      fs *= 0.94;
      if (fs < size * 0.066) return;
      body.nameEl.style.fontSize = fs.toFixed(2) + 'px';
      body.emojiEl.style.fontSize = Math.max(size * 0.12, fs * 1.5).toFixed(2) + 'px';
    }
  }

  /** 建一颗普通的活动气泡（只管长什么样，位置/速度另外给） */
  function createActivityBubble(act, size) {
    var pal = CATS[act.cat] || { c1: '#ffe3b0', c2: '#ff8fb1' };

    var holder = document.createElement('div');
    holder.className = 'bubble-holder';
    holder.style.setProperty('--size', size + 'px');

    var el = document.createElement('button');
    el.type = 'button';
    el.className = 'bubble';
    el.dataset.id = String(act.id);
    el.setAttribute('aria-label', act.title + '：' + act.summary);
    el.style.setProperty('--c1', pal.c1);
    el.style.setProperty('--c2', pal.c2);

    var emoji = document.createElement('span');
    emoji.className = 'bubble-emoji';
    emoji.textContent = act.emoji;
    var name = document.createElement('span');
    name.className = 'bubble-name';
    name.textContent = act.title;
    el.appendChild(emoji);
    el.appendChild(name);
    holder.appendChild(el);

    if (visited[act.id]) el.classList.add('is-visited');

    el.addEventListener('click', function (ev) {
      if (drag.moved) { ev.preventDefault(); return; }   // 刚滑过屏，不算点击
      go('activity/' + act.id);
    });

    return {
      holder: holder, btn: el, nameEl: name, emojiEl: emoji, act: act,
      title: act.title, r: size / 2,
      x: 0, y: 0, vx: 0, vy: 0, squash: 0, axis: 'x', grow: 1
    };
  }

  /** 正中央那颗白色气泡：发布你的活动。
      它是"静态障碍物"（逆质量为 0），自己不动，但别的气泡撞上来会被弹开。 */
  function createPublishBubble(size) {
    var holder = document.createElement('div');
    holder.className = 'publish-holder';
    holder.style.setProperty('--size', size + 'px');

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'publish-bubble';
    btn.id = 'publish-bubble';
    btn.setAttribute('aria-label', '发布你的活动');

    var plus = document.createElement('span');
    plus.className = 'publish-plus';
    plus.textContent = '＋';
    var label = document.createElement('span');
    label.className = 'publish-label';
    label.textContent = '发布你的活动';
    var hint = document.createElement('span');
    hint.className = 'publish-hint';
    hint.textContent = '点我发布';
    btn.appendChild(plus);
    btn.appendChild(label);
    btn.appendChild(hint);

    btn.addEventListener('click', function (ev) {
      if (drag.moved) { ev.preventDefault(); return; }
      go('publish');
    });

    holder.appendChild(btn);
    return {
      holder: holder, btn: btn, isStatic: true, isPublish: true,
      title: '发布你的活动', r: size / 2,
      x: 0, y: 0, vx: 0, vy: 0, squash: 0, axis: 'x', grow: 1
    };
  }

  function buildBubbles() {
    var wrap = $('#field-wrap');
    var field = $('#field');
    if (!wrap || !field || !TOTAL) return;

    var vw = wrap.clientWidth;
    var vh = wrap.clientHeight;
    var n = TOTAL + 1;   // 多留一颗给中央的发布气泡

    var cols = Math.max(4, Math.min(8, Math.round(Math.sqrt(n * vw / Math.max(1, vh)))));
    var rows = Math.ceil(n / cols);
    var cell = Math.round(Math.max(200, Math.min(300, Math.sqrt(vw * vh) / 2.6)));

    // 保证横向、纵向都一定比屏幕大，滑动才有意义
    while (cols * cell < vw * 1.15) cols++;
    while (rows * cell < vh * 1.15) rows++;

    CELL_SIZE = cell;
    FIELD_W = cols * cell;
    FIELD_H = rows * cell;
    field.style.width = FIELD_W + 'px';
    field.style.height = FIELD_H + 'px';

    // 网格槽位：先填靠近中心的槽位，一进来中间就有气泡
    var slots = [];
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        slots.push({ c: c, r: r, d: Math.hypot(c - (cols - 1) / 2, r - (rows - 1) / 2) });
      }
    }
    shuffle(slots);
    slots.sort(function (a, b) { return a.d - b.d; });

    // 正中间要留给「发布你的活动」，离得太近的槽位跳过
    var pubSize = Math.round(cell * 0.74);
    var fieldCx = FIELD_W / 2;
    var fieldCy = FIELD_H / 2;
    var slotIndex = 0;
    function takeSlot(size) {
      while (slotIndex < slots.length) {
        var s = slots[slotIndex];
        slotIndex++;
        var sx = s.c * cell + cell / 2;
        var sy = s.r * cell + cell / 2;
        if (Math.hypot(sx - fieldCx, sy - fieldCy) > pubSize / 2 + size / 2 + 14) return s;
      }
      return slots[slots.length - 1];
    }

    var order = shuffle(ACTIVITIES.slice());
    var frag = document.createDocumentFragment();
    // 小屏要让气泡相对大一点，否则字太小；大屏反而要小一点
    var frac = vw < 700 ? 0.58 : 0.50;

    bodies = [];

    order.forEach(function (act) {
      var size = Math.round(cell * (frac + Math.random() * 0.06));
      var slot = takeSlot(size);
      var jx = (Math.random() - 0.5) * (cell - size) * 0.8;
      var jy = (Math.random() - 0.5) * (cell - size) * 0.8;
      var left = slot.c * cell + (cell - size) / 2 + jx;
      var top = slot.r * cell + (cell - size) / 2 + jy;

      left = Math.max(4, Math.min(FIELD_W - size - 4, left));
      top = Math.max(4, Math.min(FIELD_H - size - 4, top));

      var body = createActivityBubble(act, size);
      body.x = left + size / 2;
      body.y = top + size / 2;
      var angle = Math.random() * Math.PI * 2;
      var speed = reduceMotion ? 0 : SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN);
      body.vx = Math.cos(angle) * speed;
      body.vy = Math.sin(angle) * speed;

      frag.appendChild(body.holder);
      bodies.push(body);
    });

    // 中央的发布气泡
    publishBody = createPublishBubble(pubSize);
    publishBody.x = fieldCx;
    publishBody.y = fieldCy;
    frag.appendChild(publishBody.holder);
    bodies.push(publishBody);

    field.appendChild(frag);

    // 字号自适应（放在入场动画之前量，避免被动画的 scale 影响）
    bodies.forEach(function (b) { if (!b.isPublish) fitBubbleText(b); });
    bodies.forEach(function (b) { if (!b.isPublish) b.btn.classList.add('is-in'); });

    renderPhysics();

    pan.x = (vw - FIELD_W) / 2;
    pan.y = (vh - FIELD_H) / 2;
    applyPan();

    refreshTotal();
    var counter = $('#count');
    if (counter) counter.textContent = String(visitedCount);

    startPhysics();
  }

  /* ---- 物理：自己慢慢乱动 + 撞墙 + 气泡之间碰撞挤压 ---- */
  function stepPhysics(dt) {
    var list = bodies;
    var i, j, b;

    for (i = 0; i < list.length; i++) {
      b = list[i];
      // 正在"吹大"的气泡：先长大，长好了才给它初速度
      if (b.grow < 1) {
        b.grow = Math.min(1, b.grow + dt / 0.55);
        if (b.grow >= 1 && !b.isStatic) {
          var a0 = Math.random() * Math.PI * 2;
          var sp0 = SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN);
          b.vx = Math.cos(a0) * sp0;
          b.vy = Math.sin(a0) * sp0;
        }
      }
      if (b.squash > 0) b.squash *= Math.pow(0.03, dt);   // 挤压形变慢慢回弹
      if (b.isStatic || b.grow < 1) continue;             // 中央那颗不动；吹大过程中也不动

      b.x += b.vx * dt;
      b.y += b.vy * dt;

      if (b.x - b.r < 0) { b.x = b.r; b.vx = Math.abs(b.vx) * WALL_DAMP; }
      if (b.x + b.r > FIELD_W) { b.x = FIELD_W - b.r; b.vx = -Math.abs(b.vx) * WALL_DAMP; }
      if (b.y - b.r < 0) { b.y = b.r; b.vy = Math.abs(b.vy) * WALL_DAMP; }
      if (b.y + b.r > FIELD_H) { b.y = FIELD_H - b.r; b.vy = -Math.abs(b.vy) * WALL_DAMP; }
    }

    for (i = 0; i < list.length; i++) {
      for (j = i + 1; j < list.length; j++) {
        var a = list[i];
        var c = list[j];
        if (a.grow < 1 || c.grow < 1) continue;   // 还没吹好的气泡先不参与碰撞
        var dx = c.x - a.x;
        var dy = c.y - a.y;
        var dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
        var minD = a.r + c.r;
        if (dist >= minD) continue;

        var nx = dx / dist;
        var ny = dy / dist;
        var overlap = minD - dist;

        // 用「逆质量」统一处理：静态气泡（中央那颗发布气泡）逆质量为 0，
        // 自己不会被推动，只把别人挤开
        var invA = a.isStatic ? 0 : 1 / (a.r * a.r);
        var invC = c.isStatic ? 0 : 1 / (c.r * c.r);
        var invSum = invA + invC;
        if (invSum <= 0) continue;
        collisionCount++;

        a.x -= nx * overlap * (invA / invSum);
        a.y -= ny * overlap * (invA / invSum);
        c.x += nx * overlap * (invC / invSum);
        c.y += ny * overlap * (invC / invSum);

        // 沿法线交换动量，带一点弹性
        var vn = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
        if (vn < 0) {
          var imp = -(1 + RESTITUTION) * vn / invSum;
          a.vx -= imp * nx * invA; a.vy -= imp * ny * invA;
          c.vx += imp * nx * invC; c.vy += imp * ny * invC;
        }

        // 挤压：按「撞击速度」给形变。
        // 不要用几何重叠量——这种慢速运动里每帧穿透只有零点几像素，算出来根本看不见。
        var impact = Math.max(Math.abs(vn), 10);
        var depth = Math.min(1, impact / 26);
        if (depth > a.squash) a.squash = depth;
        if (depth > c.squash) c.squash = depth;
        a.axis = c.axis = Math.abs(nx) > Math.abs(ny) ? 'x' : 'y';
      }
    }

    // 速度限幅：既不会越撞越快，也不会停下来不动
    for (i = 0; i < list.length; i++) {
      b = list[i];
      if (b.isStatic || b.grow < 1) continue;
      var sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      if (sp > SPEED_MAX) {
        b.vx *= SPEED_MAX / sp; b.vy *= SPEED_MAX / sp;
      } else if (sp < SPEED_MIN) {
        if (sp < 0.05) {
          var ang = Math.random() * Math.PI * 2;
          b.vx = Math.cos(ang) * SPEED_MIN;
          b.vy = Math.sin(ang) * SPEED_MIN;
        } else {
          b.vx *= SPEED_MIN / sp; b.vy *= SPEED_MIN / sp;
        }
      }
    }
  }

  function renderPhysics() {
    for (var i = 0; i < bodies.length; i++) {
      var b = bodies[i];
      var s = Math.min(SQUASH_MAX, b.squash * 0.2);
      var sx = 1, sy = 1;
      if (s > 0.001) {
        // 沿碰撞法线压扁、垂直方向微微鼓起
        if (b.axis === 'x') { sx = 1 - s; sy = 1 + s * 0.55; }
        else { sx = 1 + s * 0.55; sy = 1 - s; }
      }
      // 刚吹出来时由小变大，中段稍微鼓一下，像真的在吹气
      if (b.grow < 1) {
        var g = 0.1 + 0.9 * (1 - Math.pow(1 - b.grow, 3));
        g *= 1 + 0.12 * Math.sin(Math.PI * b.grow);
        sx *= g;
        sy *= g;
      }
      b.holder.style.transform =
        'translate3d(' + (b.x - b.r).toFixed(1) + 'px,' + (b.y - b.r).toFixed(1) + 'px,0) scale(' +
        sx.toFixed(4) + ',' + sy.toFixed(4) + ')';
    }
  }

  function physicsLoop(now) {
    physRaf = requestAnimationFrame(physicsLoop);
    var dt = Math.min(0.033, Math.max(0, (now - physLast) / 1000));
    physLast = now;
    if (document.hidden || currentRoute() !== 'activities') return;
    stepPhysics(dt);
    renderPhysics();
  }

  function startPhysics() {
    // reduceMotion：尊重"减少动态效果"设置，不飘
    // physPaused：自检页会打开它，改成用手动 tick 推进（确定性更好，
    // 而且常驻 rAF 会让无头浏览器的虚拟时钟不再推进，把自检页卡死）
    if (reduceMotion || physPaused) { renderPhysics(); return; }
    if (physRaf) return;
    physLast = performance.now();
    physRaf = requestAnimationFrame(physicsLoop);
  }

  function startBubbles() {
    buildBubbles();
  }

  /* ---- 发布自己的活动：吹一颗新气泡出来 ---- */
  function findBody(id) {
    for (var i = 0; i < bodies.length; i++) {
      if (bodies[i].act && bodies[i].act.id === id) return bodies[i];
    }
    return null;
  }

  /** 吹气的视觉效果：中央冒出一圈气环 + 一堆小泡泡往外飞 */
  function blowEffect(cx, cy) {
    var field = $('#field');
    if (!field) return;
    var i, p;

    var n = window.innerWidth < 700 ? 10 : 16;
    for (i = 0; i < n; i++) {
      p = document.createElement('span');
      p.className = 'puff';
      var size = 10 + Math.random() * 26;
      var ang = Math.random() * Math.PI * 2;
      var dist = 70 + Math.random() * 160;
      p.style.left = cx + 'px';
      p.style.top = cy + 'px';
      p.style.width = size + 'px';
      p.style.height = size + 'px';
      p.style.setProperty('--tx', (Math.cos(ang) * dist).toFixed(1) + 'px');
      p.style.setProperty('--ty', (Math.sin(ang) * dist).toFixed(1) + 'px');
      p.style.setProperty('--pd', (0.75 + Math.random() * 0.5).toFixed(2) + 's');
      field.appendChild(p);
      (function (node) { setTimeout(function () { node.remove(); }, 1700); })(p);
    }

    for (i = 0; i < 2; i++) {
      var ring = document.createElement('span');
      ring.className = 'blow-ring';
      ring.style.left = cx + 'px';
      ring.style.top = cy + 'px';
      ring.style.width = (74 + i * 48) + 'px';
      ring.style.height = (74 + i * 48) + 'px';
      field.appendChild(ring);
      (function (node) { setTimeout(function () { node.remove(); }, 1400); })(ring);
    }
  }

  /** 把某颗气泡从中央"吹"出来：由小变大，长好之后自己飘走 */
  function blowUpBubble(body) {
    if (!body) return;
    var ang = Math.random() * Math.PI * 2;
    var dist = (publishBody ? publishBody.r : 0) + body.r + 12;
    body.x = FIELD_W / 2 + Math.cos(ang) * dist;
    body.y = FIELD_H / 2 + Math.sin(ang) * dist;
    body.vx = 0;
    body.vy = 0;
    body.grow = 0;                                // 物理里会把它吹大
    if (publishBody) publishBody.squash = 0.9;    // 中央那颗跟着鼓一下
    blowEffect(FIELD_W / 2, FIELD_H / 2);
    renderPhysics();
    recenter();
    toast('✨ 「' + body.title + '」已经吹成气泡了');
  }

  /** 发布：存到本机 + 变成一颗新气泡 */
  function publishActivity(act) {
    MY_ACTIVITIES.push(act);
    saveMyActivities();
    ACTIVITIES.push(act);
    refreshTotal();

    go('activities');

    if (!bubblesStarted) {
      // 还没建过气泡墙：等进去建的时候一起建出来，进去后再补吹气动画
      pendingBlowId = act.id;
      return;
    }

    var frac = window.innerWidth < 700 ? 0.58 : 0.50;
    var size = Math.round(CELL_SIZE * (frac + Math.random() * 0.06));
    var body = createActivityBubble(act, size);
    fitBubbleText(body);
    body.btn.classList.add('is-in');
    var field = $('#field');
    if (field) field.appendChild(body.holder);
    bodies.push(body);
    blowUpBubble(body);
  }

  function deleteActivity(id) {
    var act = null;
    for (var i = 0; i < ACTIVITIES.length; i++) {
      if (ACTIVITIES[i].id === id) act = ACTIVITIES[i];
    }
    if (!act || !act.custom) return;

    ACTIVITIES = ACTIVITIES.filter(function (a) { return a.id !== id; });
    MY_ACTIVITIES = MY_ACTIVITIES.filter(function (a) { return a.id !== id; });
    saveMyActivities();

    var body = findBody(id);
    if (body) {
      if (body.holder.parentNode) body.holder.parentNode.removeChild(body.holder);
      bodies.splice(bodies.indexOf(body), 1);
    }
    if (visited[id]) { delete visited[id]; visitedCount = Math.max(0, visitedCount - 1); }

    refreshTotal();
    var counter = $('#count');
    if (counter) counter.textContent = String(visitedCount);
    go('activities');
    toast('已删除「' + act.title + '」');
  }

  /* ---- 发布表单 ---- */
  var EMOJI_CHOICES = ['🎈', '✨', '🎯', '📣', '🎪', '🎨', '🎮', '🏸', '☕', '📚', '🧩', '🚀', '🎤', '🌱', '🤝', '💡', '🍜', '🧠'];
  var pickedEmoji = EMOJI_CHOICES[0];
  var formBuilt = false;

  function stickersFor(cat, emoji) {
    var base = null;
    var list = window.CAMPUS_ACTIVITIES || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].cat === cat && list[i].stickers) { base = list[i]; break; }
    }
    var out = [emoji];
    if (base) {
      base.stickers.forEach(function (s) {
        if (out.length < 4 && out.indexOf(s) < 0) out.push(s);
      });
    }
    var fallback = ['✨', '🎈', '📌', '💬'];
    for (var k = 0; k < fallback.length && out.length < 4; k++) {
      if (out.indexOf(fallback[k]) < 0) out.push(fallback[k]);
    }
    return out;
  }

  function buildPublishForm() {
    if (formBuilt) return;
    formBuilt = true;

    var box = $('#pf-emojis');
    if (box) {
      EMOJI_CHOICES.forEach(function (em, idx) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'emoji-opt' + (idx === 0 ? ' is-picked' : '');
        b.dataset.emoji = em;
        b.textContent = em;
        b.addEventListener('click', function () {
          pickedEmoji = em;
          $$('.emoji-opt', box).forEach(function (o) { o.classList.toggle('is-picked', o === b); });
        });
        box.appendChild(b);
      });
    }

    var sel = $('#pf-cat');
    if (sel) {
      var cats = Object.keys(CATS);
      cats.forEach(function (cat) {
        var o = document.createElement('option');
        o.value = cat;
        o.textContent = cat;
        sel.appendChild(o);
      });
      sel.value = CATS['学生发起'] ? '学生发起' : (cats[0] || '');
    }

    var form = $('#publish-form');
    if (form) form.addEventListener('submit', submitPublish);
  }

  function val(sel) {
    var el = $(sel);
    return el ? String(el.value || '').trim() : '';
  }

  function showPublishError(msg) {
    var el = $('#pf-error');
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function nextCustomId() {
    var max = 1000;
    MY_ACTIVITIES.forEach(function (a) { if (a.id > max) max = a.id; });
    return max + 1;
  }

  function resetPublishForm() {
    ['#pf-title', '#pf-summary', '#pf-time', '#pf-place', '#pf-join', '#pf-target', '#pf-tip'].forEach(function (sel) {
      var el = $(sel);
      if (el) el.value = '';
    });
    showPublishError('');
  }

  function submitPublish(e) {
    if (e && e.preventDefault) e.preventDefault();

    var title = val('#pf-title');
    if (!title) {
      showPublishError('先给活动起个名字吧');
      var input = $('#pf-title');
      if (input && input.focus) input.focus();
      return;
    }
    if (title.length > 20) { showPublishError('活动名称最多 20 个字'); return; }
    showPublishError('');

    var catEl = $('#pf-cat');
    var cat = (catEl && catEl.value) || '学生发起';
    var time = val('#pf-time');
    var place = val('#pf-place');
    var join = val('#pf-join');
    var target = val('#pf-target');
    var tip = val('#pf-tip');
    var summary = val('#pf-summary') || '这是你刚刚发布的活动，点开看看详情。';

    var facts = [];
    if (time) facts.push(['时间', time]);
    if (place) facts.push(['地点', place]);
    if (join) facts.push(['参加方式', join]);
    if (target) facts.push(['面向对象', target]);
    facts.push(['发布方式', '由本页使用者自行发布']);

    var notes = [];
    if (tip) notes.push('💡 ' + tip);
    notes.push('这条活动由你自己发布，只保存在这台设备的浏览器里。');

    publishActivity({
      id: nextCustomId(),
      title: title,
      emoji: pickedEmoji,
      cat: cat,
      status: '学生发布',
      tone: 'info',
      source: '由你发布',
      summary: summary,
      facts: facts,
      notes: notes,
      stickers: stickersFor(cat, pickedEmoji),
      custom: true
    });

    resetPublishForm();
  }

  /* ---- 拖动 / 滑动 ---- */
  function bindPan() {
    var wrap = $('#field-wrap');
    if (!wrap) return;
    var activeId = null;

    function onMove(e) {
      if (!drag.active || e.pointerId !== activeId) return;
      var dx = e.clientX - drag.lastX;
      var dy = e.clientY - drag.lastY;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;

      if (!drag.moved &&
          (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY)) > 9) {
        drag.moved = true;
      }

      pan.x += dx;
      pan.y += dy;
      // 惯性：一次甩动的滑行距离大约是拖动距离的 2 倍
      vel.x = vel.x * 0.55 + dx * 0.28;
      vel.y = vel.y * 0.55 + dy * 0.28;
      applyPan();
    }

    function onUp(e) {
      if (!drag.active) return;
      if (activeId !== null && e.pointerId !== activeId) return;
      drag.active = false;
      activeId = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      wrap.classList.remove('is-dragging');
      if (Math.abs(vel.x) > 1.5 || Math.abs(vel.y) > 1.5) glide();
      // 本次手势产生的 click 在下一帧才复位，避免滑屏结束时被误判成点击
      setTimeout(function () { drag.moved = false; }, 0);
    }

    wrap.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      // 拖动时顺手清掉已经选中的文字，避免一路拖着高亮
      var sel = window.getSelection && window.getSelection();
      if (sel && sel.removeAllRanges) sel.removeAllRanges();

      drag.active = true;
      drag.moved = false;
      drag.startX = drag.lastX = e.clientX;
      drag.startY = drag.lastY = e.clientY;
      activeId = e.pointerId;
      vel.x = 0; vel.y = 0;
      cancelAnimationFrame(glideRaf);
      wrap.classList.add('is-dragging');

      // 这里千万不要用 setPointerCapture：
      // 一旦捕获指针，浏览器会把紧随其后的 click 派发到「捕获元素」（也就是这层容器）上，
      // 气泡自己的 click 就永远不会触发 —— 表现就是「点气泡没反应」。
      // 改成在 window 上监听移动/抬起，滑动效果一样，但子元素照常收到 click。
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });

    wrap.addEventListener('wheel', function (e) {
      e.preventDefault();
      vel.x = 0; vel.y = 0;
      pan.x -= e.deltaX;
      pan.y -= e.deltaY;
      applyPan();
    }, { passive: false });

    // 兜底：在这个界面里拖动产生的选区一律阻止（CSS 的 user-select:none 是主手段，
    // 但有些浏览器在按钮文字上仍会起选区，这里再拦一道）
    wrap.addEventListener('selectstart', function (e) { e.preventDefault(); });
    wrap.addEventListener('dragstart', function (e) { e.preventDefault(); });
  }

  function glide() {
    cancelAnimationFrame(glideRaf);
    function step() {
      vel.x *= 0.86;
      vel.y *= 0.86;
      if (Math.abs(vel.x) < 0.35 && Math.abs(vel.y) < 0.35) {
        vel.x = 0; vel.y = 0;
        return;
      }
      var beforeX = pan.x;
      var beforeY = pan.y;
      pan.x += vel.x;
      pan.y += vel.y;
      applyPan();
      if (pan.x === beforeX && pan.y === beforeY) {  // 撞到边界就停下
        vel.x = 0; vel.y = 0;
        return;
      }
      glideRaf = requestAnimationFrame(step);
    }
    glideRaf = requestAnimationFrame(step);
  }

  /** 回到场地中央：用 CSS 过渡，不依赖 requestAnimationFrame */
  function recenter() {
    var wrap = $('#field-wrap');
    var field = $('#field');
    if (!wrap || !field) return;
    cancelAnimationFrame(glideRaf);
    vel.x = 0; vel.y = 0;

    pan.x = (wrap.clientWidth - FIELD_W) / 2;
    pan.y = (wrap.clientHeight - FIELD_H) / 2;

    field.style.transition = 'transform .55s cubic-bezier(.16,1,.3,1)';
    applyPan();
    setTimeout(function () { field.style.transition = ''; }, 600);
  }

  /* ---- 界面 4：活动详情 ---- */
  var STICKER_SPOTS = [
    [8, 16], [78, 8], [4, 60], [82, 56], [24, 82], [68, 80]
  ];
  var STICKER_SIZES = [30, 24, 26, 28, 22, 26];

  /** 关键信息（截止、变更、名额这类）在详情页里高亮 */
  var KEY_LABELS = /截止|提醒|变更|名额|状态|当前状态|回放|提取/;

  function renderDetail(act) {
    var pal = CATS[act.cat] || { c1: '#a8e0ff', c2: '#2f7cf6' };
    var scene = $('#scene-detail');
    scene.style.setProperty('--c1', pal.c1);
    scene.style.setProperty('--c2', pal.c2);

    $('#detail-emoji').textContent = act.emoji;
    $('#detail-cat').textContent = act.cat;
    $('#detail-title').textContent = act.title;
    $('#detail-summary').textContent = act.summary;
    $('#detail-index').textContent = '第 ' + act.id + ' / ' + TOTAL + ' 个';

    var status = $('#detail-status');
    status.textContent = act.status || '';
    status.className = 'detail-status tone-' + (act.tone || 'info');

    var source = $('#detail-source');
    source.textContent = act.source ? ('发布方：' + act.source) : '';
    source.hidden = !act.source;

    // 环绕贴纸
    var box = $('#detail-stickers');
    box.innerHTML = '';
    (act.stickers || []).forEach(function (sym, i) {
      var s = document.createElement('span');
      var spot = STICKER_SPOTS[i % STICKER_SPOTS.length];
      s.className = 'hero-st';
      s.textContent = sym;
      s.style.setProperty('--x', spot[0] + '%');
      s.style.setProperty('--y', spot[1] + '%');
      s.style.setProperty('--s', STICKER_SIZES[i % STICKER_SIZES.length] + 'px');
      s.style.setProperty('--d', (4.6 + i * 0.45).toFixed(2) + 's');
      s.style.setProperty('--dl', (-i * 0.7).toFixed(2) + 's');
      box.appendChild(s);
    });

    // 信息卡
    var list = $('#detail-facts');
    list.innerHTML = '';
    (act.facts || []).forEach(function (pair) {
      var li = document.createElement('li');
      if (KEY_LABELS.test(pair[0])) li.className = 'is-key';
      var k = document.createElement('span');
      k.className = 'k';
      k.textContent = pair[0];
      var v = document.createElement('span');
      v.className = 'v';
      v.textContent = pair[1];
      li.appendChild(k);
      li.appendChild(v);
      list.appendChild(li);
    });

    // 风险提示
    var riskBox = $('#detail-risk');
    if (act.risk) {
      riskBox.hidden = false;
      $('#detail-risk-text').textContent = (act.notes && act.notes[0]) || '该信息未提供完整内容，请谨慎核实。';
    } else {
      riskBox.hidden = true;
    }

    // 注意事项（风险提示已经单独显示过一条，避免重复）
    var notes = (act.notes || []).slice(act.risk ? 1 : 0);
    var noteBox = $('#detail-notes');
    var noteList = $('#detail-note-list');
    noteList.innerHTML = '';
    if (notes.length) {
      notes.forEach(function (text) {
        var li = document.createElement('li');
        li.textContent = text;
        noteList.appendChild(li);
      });
      noteBox.hidden = false;
    } else {
      noteBox.hidden = true;
    }

    // 自己发布的活动可以删掉（两步确认，不弹系统对话框）
    var del = $('#detail-delete');
    if (del) {
      if (act.custom) {
        del.hidden = false;
        del.dataset.armed = '';
        del.textContent = '删除这个活动';
        del.onclick = function () {
          if (del.dataset.armed === '1') { deleteActivity(act.id); return; }
          del.dataset.armed = '1';
          del.textContent = '再点一次确认删除';
          setTimeout(function () {
            if (del.dataset.armed === '1') {
              del.dataset.armed = '';
              del.textContent = '删除这个活动';
            }
          }, 3200);
        };
      } else {
        del.hidden = true;
        del.onclick = null;
      }
    }

    $('#detail-scroll').scrollTop = 0;
  }

  function markVisited(id) {
    var bubble = $('.bubble[data-id="' + id + '"]');
    if (bubble) bubble.classList.add('is-visited');
    if (visited[id]) return;
    visited[id] = true;
    visitedCount++;
    var counter = $('#count');
    if (counter) counter.textContent = String(visitedCount);
    if (visitedCount === TOTAL) {
      setTimeout(function () {
        toast('🎊 26 个活动你都看过了，大学生活可以由你决定');
      }, 500);
    }
  }

  function toast(text) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
  }

  /* ---------------------------------------------------------
     事件绑定 & 启动
     --------------------------------------------------------- */
  var btnEnter = $('#btn-enter');
  if (btnEnter) btnEnter.addEventListener('click', function () { go('intro'); });

  var btnSkip = $('#btn-skip');
  if (btnSkip) btnSkip.addEventListener('click', skipLines);

  var sceneLines = $('#scene-lines');
  if (sceneLines) {
    sceneLines.addEventListener('click', function (e) {
      if (e.target === sceneLines) skipLines();   // 点空白处跳过
    });
  }

  var btnRecenter = $('#btn-recenter');
  if (btnRecenter) btnRecenter.addEventListener('click', recenter);

  // 所有返回键：data-back 里写的就是要回到哪个界面
  $$('[data-back]').forEach(function (btn) {
    btn.addEventListener('click', function () { go(btn.dataset.back); });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var route = currentRoute();
      if (route === 'welcome') return;
      if (/^activity\//.test(route)) { go('activities'); return; }
      if (route === 'activities') { go('intro'); return; }
      go('welcome');
      return;
    }
    if (!bubblesStarted || currentRoute() !== 'activities') return;
    var step = 90;
    if (e.key === 'ArrowLeft') { pan.x += step; applyPan(); }
    else if (e.key === 'ArrowRight') { pan.x -= step; applyPan(); }
    else if (e.key === 'ArrowUp') { pan.y += step; applyPan(); }
    else if (e.key === 'ArrowDown') { pan.y -= step; applyPan(); }
  });

  window.addEventListener('resize', function () {
    if (bubblesStarted && currentRoute() === 'activities') applyPan();
  });

  window.addEventListener('hashchange', function () { applyRoute(currentRoute()); });

  bindPan();
  applyRoute(currentRoute());

  // 方便在控制台里跳转调试
  window.campusGo = go;
  window.campusRoute = currentRoute;

  // 物理系统的调试/自检入口：
  //   campusPhysics.tick(0.05)  手动推进一帧（自检页用它确定性地验证碰撞）
  //   campusPhysics.state()     当前所有气泡的位置/半径/挤压程度
  //   campusPhysics.collisions() 累计碰撞次数
  window.campusPhysics = {
    tick: function (dt) { stepPhysics(dt); renderPhysics(); },
    pause: function () {
      physPaused = true;
      if (physRaf) { cancelAnimationFrame(physRaf); physRaf = 0; }
    },
    resume: function () {
      physPaused = false;
      physRaf = 0;
      startPhysics();
    },
    state: function () {
      return bodies.map(function (b) {
        return {
          x: b.x, y: b.y, r: b.r, squash: b.squash, axis: b.axis,
          speed: Math.sqrt(b.vx * b.vx + b.vy * b.vy),
          grow: b.grow,
          isStatic: !!b.isStatic,
          isPublish: !!b.isPublish,
          title: b.title
        };
      });
    },
    collisions: function () { return collisionCount; },
    count: function () { return bodies.length; },
    activityCount: function () { return bodies.filter(function (b) { return !b.isStatic; }).length; },
    speedRange: function () { return [SPEED_MIN, SPEED_MAX]; }
  };

  // 供自检页读取「已发布的活动」等信息
  window.campusState = {
    activities: function () { return ACTIVITIES.map(function (a) { return { id: a.id, title: a.title, custom: !!a.custom }; }); },
    myActivities: function () { return MY_ACTIVITIES.map(function (a) { return { id: a.id, title: a.title }; }); },
    total: function () { return TOTAL; }
  };
})();
