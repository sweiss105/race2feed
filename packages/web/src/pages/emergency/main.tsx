import { render } from 'preact';
import '../../styles/tokens.css';
import '../../styles/base.css';
import { EmergencyApp } from '../control/App';

render(<EmergencyApp />, document.getElementById('app')!);
