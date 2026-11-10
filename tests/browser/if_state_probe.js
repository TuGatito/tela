setTimeout(function () {
  var log = {docClicks: 0};
  function q(id) { return document.getElementById(id); }
  window.addEventListener('error', function (e) { log.err = String(e.message); });
  document.addEventListener('click', function () { log.docClicks++; });
  try {
    q('keep').value = 'kept';
    q('rebuild').value = 'kept';
    var btn = document.querySelector('[data-tela-on-click="toggle"]');
    log.hasBtn = !!btn;
    btn.click();
    log.hidden = !q('keep') && !q('rebuild');
    log.dbg = document.getElementById('dbg').hidden;
    btn.click();
    log.keep = q('keep') ? q('keep').value : null;
    log.rebuild = q('rebuild') ? q('rebuild').value : null;
    log.modeLeft = !!document.querySelector('[data-tela-if-mode]');
  } catch (e) {
    log.err = String(e);
  }
  var out = document.createElement('pre');
  out.id = 'probe';
  out.textContent = JSON.stringify(log);
  document.body.appendChild(out);
}, 800);
