import './styles/main.css';
import {mountBattleApp} from './app/BattleApp';
import {validateRuntimeBattleData} from './core/runtimeValidation';

const validation = validateRuntimeBattleData();
if (!validation.ok) throw new Error(`Battle data validation failed:\n${validation.errors.join('\n')}`);

const appRoot = document.querySelector<HTMLDivElement>('#app');
if (!appRoot) throw new Error('App root not found.');

const app = mountBattleApp(appRoot);
window.addEventListener('beforeunload', () => app.dispose());
