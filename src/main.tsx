import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { store } from './store';
import { initTemplateLibrary } from './utils/templateLibrary';
import { initFolderMode } from './utils/folderLibrary';
import App from './App';
import './index.css';

// 启动前先加载模板库：套用用户保存的自定义模板，剔除用户删掉的模板
(async () => {
  try {
    await initTemplateLibrary();
  } catch (err) {
    console.error('加载自定义模板失败，使用内置模板:', err);
  }

  // 再连接文件夹（§7.6）：权限还在就静默连、顺手合并；任何失败只影响状态横幅，
  // initFolderMode 内部自带 try/catch，绝不阻塞应用启动
  await initFolderMode();

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Provider store={store}>
        <BrowserRouter basename="/photobook">
          <App />
        </BrowserRouter>
      </Provider>
    </React.StrictMode>
  );
})();
