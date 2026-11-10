setTimeout(function () {
  var log = {};
  function status() { var e = document.getElementById('status'); return e ? e.textContent : null; }
  function click(name) { document.querySelector('[data-tela-on-click="' + name + '"]').click(); }
  try {
    log.initial = status();
    click('start');
    log.loading = status();
    click('cancel');
    log.cancelled = status();
    setTimeout(function () {
      click('start');
      setTimeout(function () {
        log.done = status();
        var out = document.createElement('pre');
        out.id = 'probe';
        out.textContent = JSON.stringify(log);
        document.body.appendChild(out);
      }, 1000);
    }, 200);
  } catch (e) {
    log.err = String(e);
    var out = document.createElement('pre');
    out.id = 'probe';
    out.textContent = JSON.stringify(log);
    document.body.appendChild(out);
  }
}, 800);
