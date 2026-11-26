import { render } from 'preact';
import '../../styles/tokens.css';
import '../../styles/base.css';
import { applyTheme } from '../../lib/theme';
import { App } from './App';

applyTheme();
render(<App />, document.getElementById('app')!);
