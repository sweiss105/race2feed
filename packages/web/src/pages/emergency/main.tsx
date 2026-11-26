import { render } from 'preact';
import '../../styles/tokens.css';
import '../../styles/base.css';
import { applyTheme } from '../../lib/theme';
import { EmergencyApp } from '../control/App';

applyTheme();
render(<EmergencyApp />, document.getElementById('app')!);
