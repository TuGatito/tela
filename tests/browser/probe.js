setTimeout(function () {
  var log = {};
  try {
    var add = document.querySelector('[data-tela-on-click="add"]');
    add.click();
    add.click();
    log.items = document.querySelectorAll('#tasks li').length;
    log.count = document.querySelector('[data-tela-text="count"]').textContent;
    log.empty = !!document.querySelector('[data-tela-if="empty"]');
    var btn = document.querySelector('[data-toggle]');
    log.btn = !!btn;
    if (btn) {
      btn.click();
      log.done = btn.className;
    }
    log.text = document.querySelector('#tasks').textContent.trim();
  } catch (e) {
    log.err = String(e);
  }
  var out = document.createElement('pre');
  out.id = 'probe';
  out.textContent = JSON.stringify(log);
  document.body.appendChild(out);
}, 1000);
