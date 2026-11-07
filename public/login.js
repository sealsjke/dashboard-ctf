const form = document.getElementById('login-form');
const error = document.getElementById('login-error');
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  error.hidden = true;
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: form.elements.username.value, password: form.elements.password.value })
    });
    if (!response.ok) throw new Error((await response.json()).error || 'Не удалось войти');
    location.assign('/');
  } catch (cause) {
    error.textContent = cause.message;
    error.hidden = false;
    button.disabled = false;
  }
});
