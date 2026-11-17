// Tela enquanto o servidor acorda (no plano grátis do Render ele dorme e leva até 1 minuto)
const t0 = Date.now();
const slow = document.getElementById('slow');
const msg = document.getElementById('msg');
const retry = document.getElementById('retry');
const tick = setInterval(() => {
  const s = Math.round((Date.now() - t0) / 1000);
  if (s >= 6) slow.textContent = `O servidor estava dormindo e está acordando (${s}s). Isso pode levar até 1 minuto.`;
}, 1000);
window.addEventListener('message', e => {
  if (e.data === 'offline') {
    clearInterval(tick);
    msg.textContent = 'Não consegui falar com o servidor do Nexo.';
    slow.textContent = 'Confira a sua internet. Vou continuar tentando sozinho.';
    retry.style.display = 'inline-block';
  }
});
retry.onclick = () => location.reload();
