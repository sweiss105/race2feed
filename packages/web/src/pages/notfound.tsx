import { render } from 'preact';
import '../styles/tokens.css';
import '../styles/base.css';

render(
  <main class="center-page">
    <h1 class="title-1">Page not found</h1>
    <p class="secondary"><a href="/">Go to the home page</a></p>
  </main>,
  document.getElementById('app')!,
);
