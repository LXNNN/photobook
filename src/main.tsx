import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { store } from './store';
import { initTemplateLibrary } from './utils/templateLibrary';
import App from './App';
import './index.css';

// 启动前先加载模板库：套用用户保存的自定义模板，剔除用户删掉的模板
(async () => {
  try {
    await initTemplateLibrary();
  } catch (err) {
    console.error('加载自定义模板失败，使用内置模板:', err);
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Provider store={store}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </Provider>
    </React.StrictMode>
  );
})();
