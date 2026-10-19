/**
 * Skill GoGo —— 浏览器半区（官方 client 插件 bundle）。
 *
 * 这是 `dsh-client-modules` 约定的预构建 bundle 形态：
 *   window.__ModuleLoader__.load({ id, factory: (require) => ... })
 * factory 里只 require 平台种子模块（react），其余全部内联，因此本插件
 * 不需要任何构建步骤 —— 改完这个文件、刷新页面即生效。
 *
 * 注册内容：
 *   - 语言字典：ui 文案全部走 ctx.locale，跟随宿主语言
 *   - `sidebar.panellist`：侧边栏技能图标（点击进入主面板）
 *   - `main`（key = skill-gogo）：主面板本体
 *       浏览 / 搜索 / 分类（自建文件夹、颜色、排序、拖拽归类）
 *       使用（写入 /名字）/ 下载 zip / 复制到项目 / 管理自定义 skill 目录
 *
 * 数据来自宿主半区 `lib/index.js`：
 *   /skill-gogo/api/{state,skill,file,export,install,library,dirs,dirs/list,rescan}
 * 宿主半区未更新时（老版本没有 library 接口）面板会降级并提示重启，不会报错。
 */

window.__ModuleLoader__.load({
  id: 'dsh-skill-gogo',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    const NS = 'skillGogo'
    const API = '/skill-gogo/api'
    const PANEL_ID = 'skill-gogo'
    const LS_CWD = 'skill-gogo.cwd'
    const LS_COLLAPSED = 'skill-gogo.collapsed'
    const NONE = '' // "未分类"用空 id 表示

    /**
     * 输入区插槽的 owner props（inputActions）由「Skill」菜单组件拿到；
     * 存一份给面板的「使用」按钮复用，让两处写入都走 DSH 的正式插入通道。
     */
    const inputActionsRef = { current: null }


    /* ---------------------------------------------------------------- *
     * 语言字典（zh / en）
     * ---------------------------------------------------------------- */
    const zh = {
      panel: 'Skill GoGo',
      count: '{n} 个 skill',
      search: '搜索 skill…',
      searchTitle: '搜索 skill 名称 / 描述',
      refresh: '刷新',
      workspaceTitle: '选择在哪个工作区里查看 skill（决定项目级 .dsh/skills）',
      workspaceNone: '仅用户目录',
      all: '全部 {n}',
      selected: '已选 {n} 个',
      batchDownload: '批量下载',
      copyToProject: '复制到项目',
      clearSelection: '清空选择',
      use: '使用',
      useTitle: '把 /{name} 写进当前会话输入框',
      download: '下载',
      downloadTitle: '打包为 zip 下载',
      copyToProjectTitle: '复制到 <工作区>/.dsh/skills/',
      copyInvocation: '复制调用文本',
      reveal: '在本地显示文件',
      revealTitle: '在文件管理器里打开该 skill 所在目录并选中入口文件',
      revealed: '已在文件管理器中打开：{path}',
      revealFailed: '打开失败：{message}',
      revealUnavailable: '该 skill 没有本地文件，无法在本地显示',
      renameSkillTitle: '重命名 skill',
      renameSkillHint: '新名称需为 kebab-case（小写字母 / 数字，用 - 连接）。会同时修改 SKILL.md 的 name 字段；目录型 skill 的目录名也会跟着改。',
      renameInvalid: '名称格式不对：只能小写字母、数字和 -，且不能以 - 开头/结尾',
      renameSame: '新名称与原名相同',
      ok: '确定',
      renameDone: '已重命名为 {name}',
      renamePathDone: '（目录/文件也已改名）',
      renameFailed: '重命名失败：{message}',
      composerMenu: 'Skill',
      composerTitle: '选择要使用的 skill（可多选）',
      composerInsert: '插入调用',
      composerEmpty: '没有可用的 skill',
      composerInserted: '已插入 {n} 个 skill 调用，回车即可让 DSH 加载',
      composerCopied: '已复制 {n} 个调用到剪贴板（输入框写入失败）',
      composerSearch: '搜索 skill…',
      composerSelected: '已选 {n} 个',
      composerClear: '清空',
      composerHint: '插入后按回车即可让 DSH 加载这些 skill',
      loading: '正在读取 skill 目录…',
      detailLoading: '正在加载…',
      readFailed: '读取失败：{message}',
      retry: '重试',
      skillsUnavailable: 'skill 服务不可用',
      skillsUnavailableHint: '当前 profile 未启用 @deepseek-ai/dsh-skill，装上它之后这里会自动出现 skill 列表。',
      noMatch: '没有匹配的 skill',
      noSkills: '还没有任何 skill',
      pickSkill: '从左侧选择一个 skill 查看详情',
      pickSkillHint: '可用「使用」把 /名称 写进输入框，「下载」导出 zip，「复制到项目」装进工作区 .dsh/skills',
      noDescription: '（无描述）',
      whenToUse: '何时使用：{text}',
      source: '来源',
      provider: '提供方',
      path: '路径',
      invocation: '调用',
      noLocalPath: '（无本地路径）',
      noLocalFiles: '无本地文件',
      noContent: '（该 skill 没有可显示的正文）',
      binaryFile: '（二进制文件，{size}）',
      sourceUserDsh: '用户目录',
      sourceUserAgents: '用户 Agents',
      sourceProjectDsh: '项目 .dsh',
      sourceProjectAgents: '项目 Agents',
      sourceRuntime: '运行时',
      sourceCustom: '自定义目录',
      sourceBundled: '内置',
      sourceUnknown: '未知',
      modelOnly: '仅用户',
      invocable: '可调用',
      selectWorkspaceFirst: '先在上方选择一个工作区，再复制到项目',
      inserted: '已写入输入框：{text}（回车即可让 DSH 加载该 skill）',
      copied: '已复制 {text}，粘贴到输入框即可',
      copiedInvocation: '已复制调用文本',
      copyFailed: '复制失败，请手动复制：{text}',
      downloadStarted: '已开始下载 {n} 个 zip（浏览器可能询问是否允许多文件下载）',
      installed: '已复制 {n} 个文件到 {path}',
      installFailed: '复制失败：{message}',
      fileReadFailed: '读取文件失败：{message}',
      select: '选择 {name}',
      /* 分类 */
      newFolder: '新建分类',
      newFolderPlaceholder: '分类名称，回车确认',
      ungrouped: '未分类',
      folderMenu: '分类操作',
      rename: '重命名',
      changeColor: '颜色',
      colorDefault: '默认',
      moveUp: '上移',
      moveDown: '下移',
      deleteFolder: '删除分类',
      folderDeleted: '已删除分类「{name}」，其中的 skill 回到未分类',
      moveToFolder: '移动到分类',
      moveToUngrouped: '移出分类',
      moved: '已移动 {n} 个 skill',
      skillMenu: 'Skill 操作',
      folderCreated: '已创建分类「{name}」',
      saved: '已保存',
      saveFailed: '保存失败：{message}',
      dragHint: '提示：把 skill 拖到分类名上即可归类',
      /* 目录 */
      dirsButton: '目录',
      dirsTitle: '自定义 Skill 目录',
      dirsHint:
        '除用户目录与工作区项目目录外，可再补充多个目录；这里发现的 skill 会一起出现在面板里，模型也能用 /名字 调用它们。',
      dirMissing: '目录不存在',
      dirSkills: '{n} 个 skill',
      remove: '移除',
      close: '关闭',
      browseAdd: '浏览添加',
      systemPicker: '系统选择器',
      up: '上级',
      addCurrent: '添加当前目录',
      cancel: '取消',
      pathPlaceholder: '输入目录路径后回车',
      addedDir: '已添加目录：{path}',
      removedDir: '已移除目录：{path}',
      dirLimit: '最多 20 个补充目录',
      hasSkillBadge: '含 SKILL.md',
      rescanning: '已重扫',
      emptyDir: '（没有子目录）',
      legacyHost: '分类与自定义目录需要重启 DSH 后生效',
      legacyHostHint: '宿主半区已更新，但当前进程仍是旧版本；重启一次 DSH 即可使用文件夹分类与多目录。',
    }

    const en = {
      panel: 'Skill GoGo',
      count: '{n} skills',
      search: 'Search skills…',
      searchTitle: 'Search skill name / description',
      refresh: 'Refresh',
      workspaceTitle: 'Which workspace to read skills in (decides project-level .dsh/skills)',
      workspaceNone: 'User directories only',
      all: 'All {n}',
      selected: '{n} selected',
      batchDownload: 'Download all',
      copyToProject: 'Copy to project',
      clearSelection: 'Clear selection',
      use: 'Use',
      useTitle: 'Write /{name} into the current composer',
      download: 'Download',
      downloadTitle: 'Download as a zip',
      copyToProjectTitle: 'Copy into <workspace>/.dsh/skills/',
      copyInvocation: 'Copy invocation',
      reveal: 'Show in file manager',
      revealTitle: 'Open the skill folder in the file manager with its entry file selected',
      revealed: 'Opened in the file manager: {path}',
      revealFailed: 'Failed to open: {message}',
      revealUnavailable: 'This skill has no local files to show',
      renameSkillTitle: 'Rename skill',
      renameSkillHint: 'The new name must be kebab-case (lowercase letters / digits joined by -). The SKILL.md name field is rewritten; a directory bundle is renamed too.',
      renameInvalid: 'Invalid name: lowercase letters, digits and -, not starting or ending with -',
      renameSame: 'The new name equals the current name',
      ok: 'OK',
      renameDone: 'Renamed to {name}',
      renamePathDone: ' (folder/file renamed too)',
      renameFailed: 'Rename failed: {message}',
      composerMenu: 'Skill',
      composerTitle: 'Pick skills to use (multi-select)',
      composerInsert: 'Insert',
      composerEmpty: 'No skills available',
      composerInserted: 'Inserted {n} skill invocations; press Enter to load them',
      composerCopied: 'Copied {n} invocations (composer write failed)',
      composerSearch: 'Search skills…',
      composerSelected: '{n} selected',
      composerClear: 'Clear',
      composerHint: 'After inserting, press Enter so DSH loads those skills',
      loading: 'Reading the skill catalog…',
      detailLoading: 'Loading…',
      readFailed: 'Failed to read: {message}',
      retry: 'Retry',
      skillsUnavailable: 'Skill service unavailable',
      skillsUnavailableHint: 'This profile has no @deepseek-ai/dsh-skill enabled; the catalog appears here once it is.',
      noMatch: 'No matching skill',
      noSkills: 'No skills yet',
      pickSkill: 'Pick a skill on the left to see its details',
      pickSkillHint: 'Use writes /name into the composer, Download exports a zip, Copy to project installs into <workspace>/.dsh/skills',
      noDescription: '(no description)',
      whenToUse: 'When to use: {text}',
      source: 'Source',
      provider: 'Provider',
      path: 'Path',
      invocation: 'Invocation',
      noLocalPath: '(no local path)',
      noLocalFiles: 'no local files',
      noContent: '(this skill has no body to show)',
      binaryFile: '(binary file, {size})',
      sourceUserDsh: 'User dir',
      sourceUserAgents: 'User agents',
      sourceProjectDsh: 'Project .dsh',
      sourceProjectAgents: 'Project agents',
      sourceRuntime: 'Runtime',
      sourceCustom: 'Custom dir',
      sourceBundled: 'Bundled',
      sourceUnknown: 'Unknown',
      modelOnly: 'user-only',
      invocable: 'invocable',
      selectWorkspaceFirst: 'Pick a workspace above before copying into a project',
      inserted: 'Wrote {text} into the composer (press Enter to load the skill)',
      copied: 'Copied {text}; paste it into the composer',
      copiedInvocation: 'Invocation copied',
      copyFailed: 'Copy failed, copy it manually: {text}',
      downloadStarted: 'Started {n} zip downloads (the browser may ask about multiple downloads)',
      installed: 'Copied {n} files to {path}',
      installFailed: 'Copy failed: {message}',
      fileReadFailed: 'Failed to read the file: {message}',
      select: 'Select {name}',
      newFolder: 'New folder',
      newFolderPlaceholder: 'Folder name, Enter to confirm',
      ungrouped: 'Ungrouped',
      folderMenu: 'Folder actions',
      rename: 'Rename',
      changeColor: 'Color',
      colorDefault: 'Default',
      moveUp: 'Move up',
      moveDown: 'Move down',
      deleteFolder: 'Delete folder',
      folderDeleted: 'Deleted folder “{name}”; its skills moved to Ungrouped',
      moveToFolder: 'Move to folder',
      moveToUngrouped: 'Remove from folder',
      moved: 'Moved {n} skills',
      skillMenu: 'Skill actions',
      folderCreated: 'Created folder “{name}”',
      saved: 'Saved',
      saveFailed: 'Save failed: {message}',
      dragHint: 'Tip: drag a skill onto a folder name to file it',
      dirsButton: 'Folders',
      dirsTitle: 'Custom skill directories',
      dirsHint:
        'Beyond the user directory and workspace project directories you can add extra directories; skills found there appear in this panel and are usable through /name.',
      dirMissing: 'missing',
      dirSkills: '{n} skills',
      remove: 'Remove',
      close: 'Close',
      browseAdd: 'Browse & add',
      systemPicker: 'System picker',
      up: 'Up',
      addCurrent: 'Add this directory',
      cancel: 'Cancel',
      pathPlaceholder: 'Type a directory path, Enter to open',
      addedDir: 'Added directory: {path}',
      removedDir: 'Removed directory: {path}',
      dirLimit: 'At most 20 extra directories',
      hasSkillBadge: 'has SKILL.md',
      rescanning: 'Rescanned',
      emptyDir: '(no subdirectories)',
      legacyHost: 'Folders and custom directories need a DSH restart',
      legacyHostHint: 'The host half is updated but the running process is still the old one; restart DSH once to enable folders and extra directories.',
    }

    function makeTranslate(dict) {
      return (key, params) => {
        const template = dict[key] !== undefined ? dict[key] : key
        if (!params) return template
        return template.replace(/\{(\w+)\}/g, (all, name) => (params[name] === undefined ? all : String(params[name])))
      }
    }

    const fallbackT = makeTranslate(zh)

    /* ---------------------------------------------------------------- *
     * 样式（只引用 DSH 主题 token，跟随明暗主题）
     * ---------------------------------------------------------------- */
    const CSS = `
.skg-root{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);box-sizing:border-box;position:relative}
.skg-head{display:flex;align-items:center;gap:10px;padding:14px 16px 10px;flex-wrap:wrap}
.skg-title{display:flex;align-items:baseline;gap:8px;font-size:15px;font-weight:600;letter-spacing:.2px}
.skg-title small{font-size:11px;font-weight:400;color:var(--dsw-alias-label-secondary)}
.skg-spacer{flex:1 1 auto}
.skg-search{position:relative;display:flex;align-items:center}
.skg-search input{width:210px;padding:6px 26px 6px 28px;font-size:12px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);outline:none;font-family:inherit}
.skg-search input:focus{border-color:var(--dsw-alias-brand-primary)}
.skg-search svg{position:absolute;left:8px;opacity:.55}
.skg-search kbd{position:absolute;right:7px;font-size:10px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:4px;padding:0 4px;line-height:15px}
.skg-select{font-size:12px;font-family:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);padding:6px 8px;max-width:210px}
.skg-btn{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-family:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);padding:6px 10px;cursor:pointer;transition:background var(--ds-transition-duration) var(--ds-ease-in-out)}
.skg-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1)}
.skg-btn:disabled{opacity:.5;cursor:not-allowed}
.skg-btn-primary{color:#fff;background:var(--dsw-alias-brand-primary);border-color:transparent}
.skg-btn-primary:hover:not(:disabled){background:var(--dsw-alias-brand-primary);filter:brightness(1.06)}
.skg-chips{display:flex;align-items:center;gap:6px;padding:0 16px 8px;flex-wrap:wrap;min-height:22px}
.skg-chip{font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:2px 8px;cursor:pointer;font-family:inherit}
.skg-chip[data-active="true"]{color:#fff;background:var(--dsw-alias-brand-primary);border-color:transparent}
.skg-count{font-size:11px;color:var(--dsw-alias-label-secondary)}
.skg-hair{height:1px;background:var(--dsw-alias-border-l1);margin:0 16px}
.skg-banner{margin:0 16px 8px;padding:7px 10px;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-state-warn-primary);border-radius:var(--dsw-radius-md)}
.skg-banner b{color:var(--dsw-alias-state-warn-primary);font-weight:600}
.skg-body{display:flex;flex:1 1 auto;min-height:0;gap:0}
.skg-list{width:340px;min-width:260px;max-width:44%;overflow-y:auto;padding:8px;box-sizing:border-box;border-right:1px solid var(--dsw-alias-border-l1)}
.skg-folder{display:flex;align-items:center;gap:6px;padding:5px 6px;margin:2px 0;border:1px dashed transparent;border-radius:var(--dsw-radius-sm);cursor:pointer;user-select:none}
.skg-folder:hover{background:var(--dsw-alias-bg-layer-1)}
.skg-folder[data-drop="true"]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}
.skg-caret{width:12px;font-size:9px;color:var(--dsw-alias-label-secondary);flex:0 0 auto}
.skg-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;background:var(--dsw-alias-label-secondary)}
.skg-foldername{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.skg-folderCount{font-size:10.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.skg-folder input{width:100%;font-size:12px;font-family:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-brand-primary);border-radius:var(--dsw-radius-sm);padding:2px 5px;outline:none}
.skg-newfolder{display:flex;align-items:center;gap:6px;padding:5px 6px;margin:2px 0;font-size:11.5px;color:var(--dsw-alias-label-secondary);cursor:pointer;border-radius:var(--dsw-radius-sm)}
.skg-newfolder:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.skg-newfolder input{flex:1 1 auto;font-size:12px;font-family:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-brand-primary);border-radius:var(--dsw-radius-sm);padding:2px 5px;outline:none}
.skg-rows{padding-left:4px}
.skg-row{display:flex;gap:8px;align-items:flex-start;width:100%;text-align:left;font-family:inherit;background:transparent;border:1px solid transparent;border-radius:var(--dsw-radius-md);padding:7px 8px;cursor:pointer;color:inherit}
.skg-row:hover{background:var(--dsw-alias-bg-layer-1)}
.skg-row[data-active="true"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
.skg-row[data-dragging="true"]{opacity:.45}
.skg-check{margin-top:2px;flex:0 0 auto;accent-color:var(--dsw-alias-brand-primary)}
.skg-rowmain{min-width:0;flex:1 1 auto}
.skg-name{font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.skg-desc{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.skg-tags{display:flex;gap:5px;flex-wrap:wrap;margin-top:5px}
.skg-tag{font-size:10px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:1px 6px}
.skg-tag-brand{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.skg-detail{flex:1 1 auto;min-width:0;overflow-y:auto;padding:14px 16px 28px;box-sizing:border-box}
.skg-detail h2{margin:0 0 6px;font-size:15px;font-weight:600}
.skg-detail p{margin:0 0 10px;font-size:12.5px;color:var(--dsw-alias-label-secondary);line-height:1.6;white-space:pre-wrap}
.skg-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 14px}
.skg-meta{font-size:11.5px;color:var(--dsw-alias-label-secondary);display:grid;grid-template-columns:auto 1fr;gap:3px 10px;margin-bottom:12px}
.skg-meta code{font-family:var(--ds-font-family-code);font-size:11px;color:var(--dsw-alias-label-primary);word-break:break-all}
.skg-files{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.skg-file{font-size:11px;font-family:var(--ds-font-family-code);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);padding:2px 7px;cursor:pointer}
.skg-file[data-active="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.skg-pre{margin:0;font-family:var(--ds-font-family-code);font-size:11.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);padding:12px}
.skg-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;height:100%;color:var(--dsw-alias-label-secondary);font-size:12.5px;text-align:center;padding:24px}
.skg-hint{font-size:11.5px}
.skg-warn{color:var(--dsw-alias-state-warn-primary)}
.skg-ok{color:var(--dsw-alias-state-success-primary)}
.skg-err{color:var(--dsw-alias-state-error-primary)}
.skg-toast{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);z-index:60;max-width:80%;font-size:12px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);padding:7px 12px;box-shadow:var(--dsw-elevation-prominent,0 6px 22px rgba(0,0,0,.18))}
.skg-bar{display:flex;align-items:center;gap:8px;padding:0 16px 8px;font-size:11.5px;color:var(--dsw-alias-label-secondary);flex-wrap:wrap}
.skg-spin{display:inline-block;width:12px;height:12px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:skg-spin .8s linear infinite}
@keyframes skg-spin{to{transform:rotate(360deg)}}
.skg-menu{position:fixed;z-index:80;min-width:158px;padding:4px;font-size:12px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);box-shadow:var(--dsw-elevation-prominent,0 8px 26px rgba(0,0,0,.2))}
.skg-menuTitle{padding:4px 8px;font-size:10.5px;color:var(--dsw-alias-label-secondary);border-bottom:1px solid var(--dsw-alias-border-l1);margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}
.skg-menuItem{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:var(--dsw-radius-sm);cursor:pointer;white-space:nowrap}
.skg-menuItem:hover{background:var(--dsw-alias-bg-layer-1)}
.skg-menuItem[data-disabled="true"]{opacity:.45;cursor:not-allowed}
.skg-menuItem[data-danger="true"]{color:var(--dsw-alias-state-error-primary)}
.skg-menuSep{height:1px;background:var(--dsw-alias-border-l1);margin:3px 4px}
.skg-swatches{display:flex;gap:6px;padding:5px 8px;flex-wrap:wrap;max-width:190px}
.skg-swatch{width:16px;height:16px;border-radius:50%;border:1px solid var(--dsw-alias-border-l2);cursor:pointer}
.skg-swatch[data-active="true"]{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.skg-swatch-default{display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}
.skg-overlay{position:absolute;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb, var(--dsw-alias-bg-base) 62%, transparent)}
.skg-modal{width:min(560px,92%);max-height:82%;display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);box-shadow:var(--dsw-elevation-prominent,0 10px 30px rgba(0,0,0,.22));padding:14px 16px;box-sizing:border-box;gap:8px}
.skg-modal h3{margin:0;font-size:13.5px;font-weight:600}
.skg-modalBody{overflow-y:auto;min-height:0;display:flex;flex-direction:column;gap:6px}
.skg-modalActions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:4px}
.skg-dirRow{display:flex;align-items:center;gap:8px;font-size:11.5px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);padding:5px 8px}
.skg-dirRow code{flex:1 1 auto;min-width:0;font-family:var(--ds-font-family-code);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.skg-dirList{border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);max-height:240px;overflow-y:auto}
.skg-dirItem{display:flex;align-items:center;gap:8px;padding:5px 8px;font-size:12px;cursor:pointer}
.skg-dirItem:hover{background:var(--dsw-alias-bg-layer-1)}
.skg-pathbar{display:flex;gap:6px;align-items:center}
.skg-pathbar input{flex:1 1 auto;font-size:11.5px;font-family:var(--ds-font-family-code);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);padding:5px 7px;outline:none}
.skg-input{width:100%;box-sizing:border-box;font-size:12.5px;font-family:var(--ds-font-family-code);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);padding:7px 9px;outline:none}
.skg-input:focus{border-color:var(--dsw-alias-brand-primary)}
.skg-fieldError{font-size:11.5px;color:var(--dsw-alias-state-error-primary)}
.skg-cmWrap{position:relative;display:inline-flex}
.skg-cmBtn{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-family:inherit;color:var(--dsw-alias-label-tertiary);background:transparent;border:0;border-radius:var(--dsw-radius-sm);padding:4px 7px;cursor:pointer;transition:background var(--ds-transition-duration) var(--ds-ease-in-out)}
.skg-cmBtn:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.skg-cmBtn[data-open="true"]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.skg-cmPop{position:fixed;z-index:90;width:min(380px,calc(100vw - 24px));max-height:min(460px,60vh);display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);box-shadow:var(--dsw-elevation-prominent,0 10px 30px rgba(0,0,0,.22));padding:10px;gap:8px;box-sizing:border-box}
.skg-cmHead{display:flex;align-items:center;gap:8px}
.skg-cmTitle{font-size:12.5px;font-weight:600;flex:1 1 auto}
.skg-cmList{overflow-y:auto;min-height:0;flex:1 1 auto;display:flex;flex-direction:column;gap:1px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);padding:4px}
.skg-cmGroup{font-size:10.5px;color:var(--dsw-alias-label-secondary);padding:6px 5px 2px;display:flex;align-items:center;gap:6px}
.skg-cmGroupDot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-secondary)}
.skg-cmRow{display:flex;align-items:flex-start;gap:7px;padding:5px 6px;border-radius:var(--dsw-radius-sm);cursor:pointer}
.skg-cmRow:hover{background:var(--dsw-alias-bg-layer-1)}
.skg-cmCheck{margin-top:2px;flex:0 0 auto;accent-color:var(--dsw-alias-brand-primary)}
.skg-cmMain{min-width:0;flex:1 1 auto}
.skg-cmName{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.skg-cmDesc{font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.skg-cmFoot{display:flex;align-items:center;gap:8px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:8px;font-size:11px;color:var(--dsw-alias-label-secondary);flex-wrap:wrap}
.skg-cmHint{position:fixed;z-index:95;max-width:min(360px,80vw);font-size:11.5px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);padding:6px 10px;box-shadow:var(--dsw-elevation-prominent,0 8px 24px rgba(0,0,0,.2))}
`

    /** 样式随插件生命周期挂载/卸载（由 apply 里的 ctx.effect 负责释放）。 */
    function insertStyle() {
      if (typeof document === 'undefined') return null
      const tagId = 'dsh-skill-gogo/panel.css'
      const existing = document.querySelector('style[data-plugin-css="' + tagId + '"]')
      if (existing) return existing
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-skill-gogo'
      tag.dataset.pluginCss = tagId
      tag.textContent = CSS
      document.head.appendChild(tag)
      return tag
    }

    /* ---------------------------------------------------------------- *
     * 图标
     * ---------------------------------------------------------------- */
    function svg(size, children) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        children,
      )
    }

    function iconBook(size) {
      return svg(size, [
        h('path', { key: 'a', d: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z' }),
        h('path', { key: 'b', d: 'M19 18v3H6.5A2.5 2.5 0 0 1 4 18.5' }),
        h('path', { key: 'c', d: 'M9.5 8.5h5' }),
      ])
    }

    function iconSearch(size) {
      return svg(size, [h('circle', { key: 'a', cx: 11, cy: 11, r: 6.5 }), h('path', { key: 'b', d: 'M16 16l4 4' })])
    }

    function iconDownload(size) {
      return svg(size, [
        h('path', { key: 'a', d: 'M12 3v11' }),
        h('path', { key: 'b', d: 'M7.5 10.5 12 15l4.5-4.5' }),
        h('path', { key: 'c', d: 'M4 19h16' }),
      ])
    }

    function iconReload(size) {
      return svg(size, [h('path', { key: 'a', d: 'M20 12a8 8 0 1 1-2.3-5.6' }), h('path', { key: 'b', d: 'M20 4v4h-4' })])
    }

    function iconSend(size) {
      return svg(size, [h('path', { key: 'a', d: 'M4 12h13' }), h('path', { key: 'b', d: 'M12 6.5 17.5 12 12 17.5' })])
    }

    function iconCopy(size) {
      return svg(size, [
        h('rect', { key: 'a', x: 9, y: 9, width: 11, height: 11, rx: 2.5 }),
        h('path', { key: 'b', d: 'M15 5.5A2.5 2.5 0 0 0 12.5 3H6.5A2.5 2.5 0 0 0 4 5.5v6A2.5 2.5 0 0 0 6.5 14' }),
      ])
    }

    function iconFolder(size) {
      return svg(size, [
        h('path', { key: 'a', d: 'M3 7.5A2.5 2.5 0 0 1 5.5 5h3.2l2 2.5h7.8A2.5 2.5 0 0 1 21 10v6.5A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z' }),
      ])
    }

    function iconPlus(size) {
      return svg(size, [h('path', { key: 'a', d: 'M12 5v14' }), h('path', { key: 'b', d: 'M5 12h14' })])
    }

    /** 「在本地显示文件」：文件夹 + 指向右外的箭头。 */
    function iconReveal(size) {
      return svg(size, [
        h('path', { key: 'a', d: 'M3 7.5A2.5 2.5 0 0 1 5.5 5h3.2l2 2.5h7.8A2.5 2.5 0 0 1 21 10v6.5A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z' }),
        h('path', { key: 'b', d: 'M10.5 13.5h4.5' }),
        h('path', { key: 'c', d: 'M13 11.5 15 13.5 13 15.5' }),
      ])
    }

    /* ---------------------------------------------------------------- *
     * 小工具
     * ---------------------------------------------------------------- */
    function sourceKey(source) {
      switch (source) {
        case 'user-dsh':
          return 'sourceUserDsh'
        case 'user-agents':
          return 'sourceUserAgents'
        case 'project-dsh':
          return 'sourceProjectDsh'
        case 'project-agents':
          return 'sourceProjectAgents'
        case 'runtime':
          return 'sourceRuntime'
        case 'custom':
          return 'sourceCustom'
        case 'bundled':
          return 'sourceBundled'
        default:
          return source ? null : 'sourceUnknown'
      }
    }

    function formatSize(bytes) {
      if (!Number.isFinite(bytes)) return ''
      if (bytes < 1024) return bytes + ' B'
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
      return (bytes / 1024 / 1024).toFixed(1) + ' MB'
    }

    async function fetchJson(url, init) {
      const res = await fetch(url, Object.assign({ credentials: 'same-origin' }, init || {}))
      let payload = null
      try {
        payload = await res.json()
      } catch {
        throw new Error('HTTP ' + res.status)
      }
      if (!res.ok || !payload || payload.ok === false) {
        throw new Error((payload && payload.error) || 'HTTP ' + res.status)
      }
      return payload
    }

    function copyText(text, notify, okMessage, failMessage) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(
            () => notify(okMessage),
            () => notify(failMessage),
          )
          return
        }
      } catch {
        /* 走下面的兜底 */
      }
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.setAttribute('readonly', '')
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        notify(okMessage)
      } catch {
        notify(failMessage)
      }
    }

    /**
     * 把一段文本写进当前会话输入框（Lexical contenteditable）。
     * 写成功返回 true；输入框不存在或写入后读不回来返回 false。
     */
    function insertTextIntoComposer(text) {
      try {
        const el = document.querySelector('[data-composer-input]')
        if (!(el instanceof HTMLElement)) return false
        el.focus()
        // 把光标放到输入框末尾：DSH 的输入框是 Lexical contenteditable，
        // 先把 range 放进去 execCommand('insertText') 才会被编辑器接管。
        const selection = window.getSelection()
        if (selection) {
          const range = document.createRange()
          range.selectNodeContents(el)
          range.collapse(false)
          selection.removeAllRanges()
          selection.addRange(range)
        }
        const inserted = document.execCommand && document.execCommand('insertText', false, text)
        const probe = String(text).split(/\s+/)[0].replace(/^\//, '')
        return inserted !== false && (!probe || (el.innerText || '').includes(probe))
      } catch {
        return false
      }
    }

    /**
     * 用输入区插槽提供的正式 API 写入（conversation.input.left 的 owner props）：
     * `captureInsertion()` 先抓当前草稿/光标，再 `insertText(text, token)`。
     * 这是 DSH 自己的插入通道，比操作 DOM 可靠；不可用时返回 false。
     */
    function insertViaInputActions(actions, text) {
      try {
        if (!actions || typeof actions.captureInsertion !== 'function' || typeof actions.insertText !== 'function') return false
        const token = actions.captureInsertion()
        if (token === null || token === undefined) return false
        const ok = actions.insertText(text, token)
        return ok !== false
      } catch {
        return false
      }
    }

    /** 把 `/name` 写进当前会话输入框；失败则退回复制。 */
    function useSkill(name, notify, t, inputActions) {
      const text = '/' + name
      if (insertViaInputActions(inputActions, text) || insertTextIntoComposer(text)) {
        notify(t('inserted', { text }))
        return
      }
      copyText(text, notify, t('copied', { text }), t('copyFailed', { text }))
    }

    /** 插入多个 skill 调用：优先正式 inputActions，其次 DOM，最后复制。 */
    function useSkills(names, notify, t, inputActions) {
      const list = (names || []).filter(Boolean)
      if (!list.length) return
      const text = list.map((n) => '/' + n).join(' ')
      if (insertViaInputActions(inputActions, text) || insertTextIntoComposer(text)) {
        notify(t('composerInserted', { n: list.length }))
        return
      }
      copyText(text, notify, t('composerCopied', { n: list.length }), t('copyFailed', { text }))
    }

    function newFolderId() {
      return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
    }

    /* ---------------------------------------------------------------- *
     * 主面板
     * ---------------------------------------------------------------- */
    function SkillGogoPanel(props) {
      const t = props && typeof props.t === 'function' ? props.t : fallbackT
      const ctxRef = props && props.clientContext ? props.clientContext : null

      const [state, setState] = React.useState({ loading: true, error: null, data: null })
      const [lib, setLib] = React.useState({ folders: [], assignments: {}, dirs: [] })
      const [cwd, setCwd] = React.useState(() => {
        try {
          return window.localStorage.getItem(LS_CWD) || ''
        } catch {
          return ''
        }
      })
      const [query, setQuery] = React.useState('')
      const [sourceFilter, setSourceFilter] = React.useState('')
      const [activeName, setActiveName] = React.useState('')
      const [detail, setDetail] = React.useState({ loading: false, error: null, data: null, file: null, fileLoading: false })
      const [checked, setChecked] = React.useState(() => new Set())
      const [collapsed, setCollapsed] = React.useState(() => {
        try {
          const raw = window.localStorage.getItem(LS_COLLAPSED)
          return new Set(raw ? JSON.parse(raw) : [])
        } catch {
          return new Set()
        }
      })
      const [menu, setMenu] = React.useState(null)
      const [renaming, setRenaming] = React.useState(null)
      const [creating, setCreating] = React.useState(false)
      const [dropTarget, setDropTarget] = React.useState(null)
      const [dirOpen, setDirOpen] = React.useState(false)
      const [browse, setBrowse] = React.useState(null)
      const [renameDialog, setRenameDialog] = React.useState(null)
      const [toast, setToast] = React.useState('')

      const searchRef = React.useRef(null)
      const toastTimer = React.useRef(null)
      const dragRef = React.useRef([])

      const notify = React.useCallback((message) => {
        setToast(message)
        if (toastTimer.current) window.clearTimeout(toastTimer.current)
        toastTimer.current = window.setTimeout(() => setToast(''), 3600)
      }, [])

      React.useEffect(
        () => () => {
          if (toastTimer.current) window.clearTimeout(toastTimer.current)
        },
        [],
      )

      const load = React.useCallback(async (nextCwd, signal) => {
        setState((prev) => Object.assign({}, prev, { loading: true, error: null }))
        try {
          const url = API + '/state' + (nextCwd ? '?cwd=' + encodeURIComponent(nextCwd) : '')
          const data = await fetchJson(url, signal ? { signal } : undefined)
          setState({ loading: false, error: null, data })
          if (data.library) setLib(data.library)
        } catch (err) {
          if (err && err.name === 'AbortError') return
          setState({ loading: false, error: String((err && err.message) || err), data: null })
        }
      }, [])

      React.useEffect(() => {
        const controller = new AbortController()
        load(cwd, controller.signal)
        return () => controller.abort()
      }, [load, cwd])

      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') {
            setMenu(null)
            setCreating(false)
            setRenaming(null)
            setDirOpen(false)
            setBrowse(null)
            setRenameDialog(null)
            return
          }
          if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey) {
            const target = event.target
            const typing =
              target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
            if (!typing && searchRef.current) {
              event.preventDefault()
              searchRef.current.focus()
            }
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [])

      const skills = (state.data && state.data.skills) || []
      const sources = (state.data && state.data.sources) || []
      const workspaces = (state.data && state.data.workspaces) || []
      const dirStatus = (state.data && state.data.dirStatus) || []
      const folderColors = (state.data && state.data.folderColors) || []
      const legacyHost = !!(state.data && state.data.library === undefined)
      const hasPicker = !!(ctxRef && typeof ctxRef.get === 'function' && ctxRef.get('uiWorkspace'))

      const filtered = React.useMemo(() => {
        const needle = query.trim().toLowerCase()
        return skills.filter((skill) => {
          if (sourceFilter && skill.source !== sourceFilter) return false
          if (!needle) return true
          return (
            skill.name.toLowerCase().includes(needle) ||
            (skill.description || '').toLowerCase().includes(needle) ||
            (skill.whenToUse || '').toLowerCase().includes(needle)
          )
        })
      }, [skills, query, sourceFilter])

      const groups = React.useMemo(() => {
        const folders = lib.folders.slice().sort((a, b) => (a.order || 0) - (b.order || 0))
        const buckets = new Map(folders.map((f) => [f.id, []]))
        const loose = []
        for (const skill of filtered) {
          const fid = lib.assignments[skill.name]
          if (fid && buckets.has(fid)) buckets.get(fid).push(skill)
          else loose.push(skill)
        }
        const out = folders.map((f) => ({ id: f.id, name: f.name, color: f.color, skills: buckets.get(f.id) || [] }))
        if (folders.length > 0 || loose.length > 0) out.push({ id: NONE, name: t('ungrouped'), color: null, skills: loose })
        return out
      }, [filtered, lib, t])

      const persist = React.useCallback(
        async (patch, options) => {
          if (!options || !options.silent) setLib((prev) => Object.assign({}, prev, patch))
          try {
            const data = await fetchJson(API + '/library', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(patch),
            })
            setLib(data.library)
            if (patch.dirs !== undefined) {
              // 目录变了 → 提供方已失效，必须重新拉一次目录才能看到新 skill
              await load(cwd)
            } else {
              setState((prev) => (prev.data ? Object.assign({}, prev, { data: Object.assign({}, prev.data, { library: data.library }) }) : prev))
            }
            if (options && options.message) notify(options.message)
            return data.library
          } catch (err) {
            notify(t('saveFailed', { message: String((err && err.message) || err) }))
            load(cwd)
            return null
          }
        },
        [cwd, load, notify, t],
      )

      /* ---------------- 分类操作 ---------------- */
      const createFolder = async (name) => {
        const folder = { id: newFolderId(), name: String(name).trim().slice(0, 40), color: null, order: lib.folders.length }
        if (!folder.name) return
        const folders = [...lib.folders, folder]
        setCreating(false)
        await persist({ folders }, { message: t('folderCreated', { name: folder.name }) })
      }

      const renameFolder = async (id, name) => {
        const clean = String(name).trim().slice(0, 40)
        setRenaming(null)
        if (!clean) return
        const folders = lib.folders.map((f) => (f.id === id ? Object.assign({}, f, { name: clean }) : f))
        await persist({ folders }, { message: t('saved') })
      }

      const colorFolder = async (id, color) => {
        const folders = lib.folders.map((f) => (f.id === id ? Object.assign({}, f, { color }) : f))
        await persist({ folders }, { message: t('saved') })
      }

      const moveFolder = async (id, delta) => {
        const ordered = lib.folders.slice().sort((a, b) => (a.order || 0) - (b.order || 0))
        const at = ordered.findIndex((f) => f.id === id)
        const to = at + delta
        if (at < 0 || to < 0 || to >= ordered.length) return
        const next = ordered.slice()
        const [item] = next.splice(at, 1)
        next.splice(to, 0, item)
        const folders = next.map((f, index) => Object.assign({}, f, { order: index }))
        await persist({ folders }, { message: t('saved') })
      }

      const deleteFolder = async (id) => {
        const folder = lib.folders.find((f) => f.id === id)
        const folders = lib.folders.filter((f) => f.id !== id).map((f, index) => Object.assign({}, f, { order: index }))
        const assignments = {}
        for (const [skill, fid] of Object.entries(lib.assignments)) if (fid !== id) assignments[skill] = fid
        await persist({ folders, assignments }, { message: t('folderDeleted', { name: folder ? folder.name : '' }) })
      }

      const assign = async (names, folderId) => {
        const list = (Array.isArray(names) ? names : [names]).filter(Boolean)
        if (!list.length) return
        const assignments = Object.assign({}, lib.assignments)
        for (const name of list) {
          if (folderId) assignments[name] = folderId
          else delete assignments[name]
        }
        await persist({ assignments }, { message: t('moved', { n: list.length }) })
        setChecked(new Set())
      }

      /* ---------------- 目录 ---------------- */
      const addDir = async (dir) => {
        if (!dir) return
        if (lib.dirs.some((d) => d.toLowerCase() === dir.toLowerCase())) {
          setBrowse(null)
          return
        }
        if (lib.dirs.length >= 20) {
          notify(t('dirLimit'))
          return
        }
        await persist({ dirs: [...lib.dirs, dir] }, { message: t('addedDir', { path: dir }) })
        setBrowse(null)
      }

      const removeDir = async (dir) => {
        await persist({ dirs: lib.dirs.filter((d) => d !== dir) }, { message: t('removedDir', { path: dir }) })
      }

      const openBrowse = async (target) => {
        setBrowse({ path: '', entries: [], parent: null, loading: true, error: null })
        try {
          const url = API + '/dirs/list' + (target ? '?path=' + encodeURIComponent(target) : '')
          const data = await fetchJson(url)
          setBrowse({ path: data.path, entries: data.entries || [], parent: data.parent, loading: false, error: null })
        } catch (err) {
          setBrowse({ path: target || '', entries: [], parent: null, loading: false, error: String((err && err.message) || err) })
        }
      }

      const pickNative = async () => {
        if (!ctxRef || typeof ctxRef.get !== 'function') return
        const ui = ctxRef.get('uiWorkspace')
        if (!ui || typeof ui.pickDirectory !== 'function') return
        try {
          const picked = await ui.pickDirectory()
          if (picked) await addDir(picked)
        } catch (err) {
          notify(String((err && err.message) || err))
        }
      }

      const rescan = async () => {
        try {
          await fetchJson(API + '/rescan', { method: 'POST' })
          notify(t('rescanning'))
        } catch {
          /* 老宿主没有该接口时静默忽略 */
        }
        await load(cwd)
      }

      /* ---------------- 详情 ---------------- */
      const openDetail = React.useCallback(
        async (name) => {
          setActiveName(name)
          setDetail({ loading: true, error: null, data: null, file: null, fileLoading: false })
          try {
            const url = API + '/skill?name=' + encodeURIComponent(name) + (cwd ? '&cwd=' + encodeURIComponent(cwd) : '')
            const data = await fetchJson(url)
            setDetail({ loading: false, error: null, data, file: null, fileLoading: false })
          } catch (err) {
            setDetail({ loading: false, error: String((err && err.message) || err), data: null, file: null, fileLoading: false })
          }
        },
        [cwd],
      )

      const openFile = React.useCallback(
        async (name, rel) => {
          setDetail((prev) => Object.assign({}, prev, { fileLoading: true }))
          try {
            const url =
              API + '/file?name=' + encodeURIComponent(name) + '&path=' + encodeURIComponent(rel) + (cwd ? '&cwd=' + encodeURIComponent(cwd) : '')
            const data = await fetchJson(url)
            setDetail((prev) => Object.assign({}, prev, { fileLoading: false, file: data.file }))
          } catch (err) {
            setDetail((prev) => Object.assign({}, prev, { fileLoading: false }))
            notify(t('fileReadFailed', { message: String((err && err.message) || err) }))
          }
        },
        [cwd, notify, t],
      )

      const download = (name) => {
        const url = API + '/export?name=' + encodeURIComponent(name) + (cwd ? '&cwd=' + encodeURIComponent(cwd) : '')
        const a = document.createElement('a')
        a.href = url
        a.download = name + '-skill.zip'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      }

      const install = async (name) => {
        if (!cwd) {
          notify(t('selectWorkspaceFirst'))
          return
        }
        try {
          const data = await fetchJson(API + '/install', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, cwd }),
          })
          notify(t('installed', { n: data.fileCount, path: data.target }))
          load(cwd)
        } catch (err) {
          notify(t('installFailed', { message: String((err && err.message) || err) }))
        }
      }

      const toggleChecked = (name) => {
        setChecked((prev) => {
          const next = new Set(prev)
          if (next.has(name)) next.delete(name)
          else next.add(name)
          return next
        })
      }

      /** 在本地文件管理器里显示该 skill（宿主半区负责拉起资源管理器 / Finder）。 */
      const revealSkill = async (name) => {
        try {
          const data = await fetchJson(API + '/reveal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, cwd }),
          })
          notify(t('revealed', { path: data.revealed }))
        } catch (err) {
          notify(t('revealFailed', { message: String((err && err.message) || err) }))
        }
      }

      /** 提交重命名：改 frontmatter / 目录 / 分类归属，然后刷新列表。 */
      const submitRename = async () => {
        if (!renameDialog) return
        const next = String(renameDialog.value || '').trim()
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(next) || next.length > 60) {
          setRenameDialog(Object.assign({}, renameDialog, { error: t('renameInvalid') }))
          return
        }
        if (next === renameDialog.name) {
          setRenameDialog(Object.assign({}, renameDialog, { error: t('renameSame') }))
          return
        }
        setRenameDialog(Object.assign({}, renameDialog, { busy: true, error: null }))
        try {
          const data = await fetchJson(API + '/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: renameDialog.name, newName: next, cwd }),
          })
          const oldName = renameDialog.name
          setRenameDialog(null)
          if (activeName === oldName) setActiveName(data.name)
          notify(t('renameDone', { name: data.name }) + (data.pathRenamed ? t('renamePathDone') : ''))
          await load(cwd)
          if (activeName === oldName) openDetail(data.name)
        } catch (err) {
          setRenameDialog((prev) => (prev ? Object.assign({}, prev, { busy: false, error: String((err && err.message) || err) }) : prev))
        }
      }

      const toggleCollapsed = (id) => {
        setCollapsed((prev) => {
          const next = new Set(prev)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          try {
            window.localStorage.setItem(LS_COLLAPSED, JSON.stringify([...next]))
          } catch {
            /* 隐私模式忽略 */
          }
          return next
        })
      }

      /* ---------------- 菜单 ---------------- */
      const openFolderMenu = (folder, event) => {
        event.preventDefault()
        event.stopPropagation()
        const ordered = lib.folders.slice().sort((a, b) => (a.order || 0) - (b.order || 0))
        const at = ordered.findIndex((f) => f.id === folder.id)
        const items = [
          { key: 'rename', label: t('rename'), onClick: () => setRenaming(folder.id) },
          {
            key: 'color',
            label: t('changeColor'),
            swatches: folderColors.length ? folderColors : ['#e5484d', '#0091ff', '#30a46c', '#6e56cf'],
            activeColor: folder.color,
            onPick: (color) => colorFolder(folder.id, color),
          },
          { key: 'sep1', type: 'sep' },
          { key: 'up', label: t('moveUp'), disabled: at <= 0, onClick: () => moveFolder(folder.id, -1) },
          { key: 'down', label: t('moveDown'), disabled: at < 0 || at >= ordered.length - 1, onClick: () => moveFolder(folder.id, 1) },
          { key: 'sep2', type: 'sep' },
          { key: 'delete', label: t('deleteFolder'), danger: true, onClick: () => deleteFolder(folder.id) },
        ]
        setMenu({ x: event.clientX, y: event.clientY, title: folder.name, items })
      }

      const openSkillMenu = (skill, event) => {
        event.preventDefault()
        event.stopPropagation()
        const names = checked.has(skill.name) ? [...checked] : [skill.name]
        const folders = lib.folders.slice().sort((a, b) => (a.order || 0) - (b.order || 0))
        const target = lib.assignments[skill.name] || null
        const items = [
          { key: 'use', label: t('use'), onClick: () => useSkill(skill.name, notify, t, inputActionsRef.current) },
          { key: 'download', label: t('download'), onClick: () => download(skill.name) },
          { key: 'install', label: t('copyToProject'), disabled: !cwd, onClick: () => install(skill.name) },
          { key: 'sep1', type: 'sep' },
          {
            key: 'move',
            label: t('moveToFolder'),
            submenu: [
              ...folders.map((f) => ({
                key: 'to-' + f.id,
                label: f.name,
                marker: target === f.id,
                onClick: () => assign(names, f.id),
              })),
              { key: 'sep2', type: 'sep' },
              { key: 'none', label: t('moveToUngrouped'), disabled: !target, onClick: () => assign(names, null) },
            ],
          },
          { key: 'sep3', type: 'sep' },
          { key: 'copy', label: t('copyInvocation'), onClick: () => copyText('/' + skill.name, notify, t('copiedInvocation'), t('copyFailed', { text: '/' + skill.name })) },
          { key: 'reveal', label: t('reveal'), disabled: !skill.dir, onClick: () => revealSkill(skill.name) },
          { key: 'rename', label: t('renameSkillTitle'), disabled: !skill.dir && !skill.path, onClick: () => setRenameDialog({ name: skill.name, value: skill.name, busy: false, error: null }) },
        ]
        setMenu({ x: event.clientX, y: event.clientY, title: skill.name, items })
      }

      /* ---------------- 渲染 ---------------- */
      const renderRow = (skill) =>
        h(
          'div',
          {
            key: skill.name,
            className: 'skg-row',
            'data-active': String(skill.name === activeName),
            role: 'button',
            tabIndex: 0,
            draggable: true,
            onClick: () => openDetail(skill.name),
            onContextMenu: (e) => openSkillMenu(skill, e),
            onDragStart: (e) => {
              const names = checked.has(skill.name) ? [...checked] : [skill.name]
              dragRef.current = names
              try {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', names.join('\n'))
              } catch {
                /* 某些环境不允许写 dataTransfer，dragRef 已是回落路径 */
              }
            },
            onDragEnd: () => {
              dragRef.current = []
              setDropTarget(null)
            },
            onKeyDown: (e) => {
              if (e.key === 'Enter' || e.key === ' ') openDetail(skill.name)
            },
          },
          h('input', {
            type: 'checkbox',
            className: 'skg-check',
            checked: checked.has(skill.name),
            'aria-label': t('select', { name: skill.name }),
            onClick: (e) => e.stopPropagation(),
            onChange: () => toggleChecked(skill.name),
          }),
          h(
            'div',
            { className: 'skg-rowmain' },
            h('div', { className: 'skg-name' }, skill.name),
            h('div', { className: 'skg-desc' }, skill.description || t('noDescription')),
            h(
              'div',
              { className: 'skg-tags' },
              h('span', { className: 'skg-tag' }, sourceKey(skill.source) ? t(sourceKey(skill.source)) : skill.source),
              skill.userInvocable ? h('span', { className: 'skg-tag skg-tag-brand' }, t('invocable')) : null,
              !skill.modelInvocable ? h('span', { className: 'skg-tag' }, t('modelOnly')) : null,
              skill.dir ? null : h('span', { className: 'skg-tag' }, t('noLocalFiles')),
            ),
          ),
        )

      const renderFolderHeader = (group) => {
        const isLoose = group.id === NONE
        const isCollapsed = collapsed.has(group.id)
        return h(
          'div',
          {
            key: 'folder-' + (group.id || 'none'),
            className: 'skg-folder',
            'data-drop': String(dropTarget === group.id),
            onClick: () => toggleCollapsed(group.id),
            onContextMenu: isLoose || legacyHost ? undefined : (e) => {
              const folder = lib.folders.find((f) => f.id === group.id)
              if (folder) openFolderMenu(folder, e)
            },
            onDragOver: (e) => {
              if (!dragRef.current.length && !(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('text/plain'))) return
              e.preventDefault()
              try {
                e.dataTransfer.dropEffect = 'move'
              } catch {
                /* 忽略 */
              }
              setDropTarget(group.id)
            },
            onDragLeave: () => setDropTarget((prev) => (prev === group.id ? null : prev)),
            onDrop: (e) => {
              e.preventDefault()
              setDropTarget(null)
              let names = dragRef.current.slice()
              if (!names.length) {
                try {
                  names = String(e.dataTransfer.getData('text/plain') || '')
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean)
                } catch {
                  names = []
                }
              }
              dragRef.current = []
              if (names.length) assign(names, isLoose ? null : group.id)
            },
            title: legacyHost ? t('legacyHost') : t('dragHint'),
          },
          h('span', { className: 'skg-caret' }, isCollapsed ? '▶' : '▼'),
          h('span', { className: 'skg-dot', style: { background: group.color || 'var(--dsw-alias-label-secondary)' } }),
          renaming === group.id
            ? h('input', {
                autoFocus: true,
                defaultValue: group.name,
                onClick: (e) => e.stopPropagation(),
                onBlur: (e) => renameFolder(group.id, e.target.value),
                onKeyDown: (e) => {
                  if (e.key === 'Enter') renameFolder(group.id, e.target.value)
                  if (e.key === 'Escape') setRenaming(null)
                },
              })
            : h('span', { className: 'skg-foldername' }, group.name),
          h('span', { className: 'skg-spacer' }),
          h('span', { className: 'skg-folderCount' }, group.skills.length),
        )
      }

      const renderMenu = () => {
        if (!menu) return null
        const width = 200
        const style = {
          left: Math.max(8, Math.min(menu.x, window.innerWidth - width - 12)),
          top: Math.max(8, Math.min(menu.y, window.innerHeight - 40 - menu.items.length * 28)),
        }
        const renderItems = (items, depth) =>
          items.map((item) => {
            if (item.type === 'sep') return h('div', { key: item.key, className: 'skg-menuSep' })
            if (item.swatches) {
              return h(
                'div',
                { key: item.key },
                h('div', { className: 'skg-menuTitle' }, item.label),
                h(
                  'div',
                  { className: 'skg-swatches' },
                  h('div', {
                    className: 'skg-swatch skg-swatch-default',
                    title: t('colorDefault'),
                    'data-active': String(!item.activeColor),
                    onClick: () => {
                      setMenu(null)
                      item.onPick(null)
                    },
                  }, '—'),
                  item.swatches.map((color) =>
                    h('div', {
                      key: color,
                      className: 'skg-swatch',
                      style: { background: color },
                      title: color,
                      'data-active': String(item.activeColor === color),
                      onClick: () => {
                        setMenu(null)
                        item.onPick(color)
                      },
                    }),
                  ),
                ),
              )
            }
            if (item.submenu) {
              return h(
                'div',
                { key: item.key },
                h('div', { className: 'skg-menuTitle' }, item.label),
                renderItems(item.submenu, (depth || 0) + 1),
              )
            }
            return h(
              'div',
              {
                key: item.key,
                className: 'skg-menuItem',
                'data-disabled': String(!!item.disabled),
                'data-danger': String(!!item.danger),
                onClick: () => {
                  if (item.disabled) return
                  setMenu(null)
                  item.onClick()
                },
              },
              item.marker ? h('span', null, '✓') : null,
              h('span', null, item.label),
            )
          })
        return h(
          'div',
          null,
          h('div', { style: { position: 'fixed', inset: 0, zIndex: 79 }, onClick: () => setMenu(null), onContextMenu: (e) => { e.preventDefault(); setMenu(null) } }),
          h('div', { className: 'skg-menu', style }, menu.title ? h('div', { className: 'skg-menuTitle' }, menu.title) : null, renderItems(menu.items, 0)),
        )
      }

      const renderDirDialog = () => {
        if (!dirOpen) return null
        const rows = dirStatus.length
          ? dirStatus.map((d) =>
              h(
                'div',
                { key: d.path, className: 'skg-dirRow' },
                h('code', { title: d.path }, d.path),
                h('span', { className: d.exists ? 'skg-ok' : 'skg-err' }, d.exists ? t('dirSkills', { n: d.skillCount }) : t('dirMissing')),
                h('button', { className: 'skg-btn', onClick: () => removeDir(d.path) }, t('remove')),
              ),
            )
          : h('div', { className: 'skg-hint' }, t('dirsHint'))
        return h(
          'div',
          { className: 'skg-overlay', onClick: () => setDirOpen(false) },
          h(
            'div',
            { className: 'skg-modal', onClick: (e) => e.stopPropagation() },
            h('h3', null, t('dirsTitle')),
            h('div', { className: 'skg-hint' }, t('dirsHint')),
            h('div', { className: 'skg-modalBody' }, rows),
            h(
              'div',
              { className: 'skg-modalActions' },
              hasPicker ? h('button', { className: 'skg-btn', onClick: pickNative }, iconFolder(13), t('systemPicker')) : null,
              h('button', { className: 'skg-btn', onClick: () => openBrowse(null) }, iconPlus(13), t('browseAdd')),
              h('button', { className: 'skg-btn', onClick: () => setDirOpen(false) }, t('close')),
            ),
          ),
        )
      }

      const renderBrowseDialog = () => {
        if (!browse) return null
        const entries = browse.entries || []
        return h(
          'div',
          { className: 'skg-overlay', onClick: () => setBrowse(null) },
          h(
            'div',
            { className: 'skg-modal', onClick: (e) => e.stopPropagation() },
            h('h3', null, t('browseAdd')),
            h(
              'div',
              { className: 'skg-pathbar' },
              h('input', {
                value: browse.path || '',
                placeholder: t('pathPlaceholder'),
                onChange: (e) => setBrowse(Object.assign({}, browse, { path: e.target.value })),
                onKeyDown: (e) => {
                  if (e.key === 'Enter') openBrowse(e.target.value)
                },
              }),
              h('button', { className: 'skg-btn', disabled: !browse.parent, onClick: () => openBrowse(browse.parent) }, t('up')),
            ),
            browse.loading
              ? h('div', { className: 'skg-hint' }, h('span', { className: 'skg-spin' }))
              : browse.error
                ? h('div', { className: 'skg-err skg-hint' }, browse.error)
                : h(
                    'div',
                    { className: 'skg-dirList' },
                    entries.length
                      ? entries.map((entry) =>
                          h(
                            'div',
                            { key: entry.path, className: 'skg-dirItem', onClick: () => openBrowse(entry.path) },
                            iconFolder(13),
                            h('span', { style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, entry.name),
                            entry.hasSkill ? h('span', { className: 'skg-tag skg-tag-brand' }, t('hasSkillBadge')) : null,
                          ),
                        )
                      : h('div', { className: 'skg-hint', style: { padding: '8px' } }, t('emptyDir')),
                  ),
            h(
              'div',
              { className: 'skg-modalActions' },
              h('button', { className: 'skg-btn skg-btn-primary', disabled: !browse.path, onClick: () => addDir(browse.path) }, t('addCurrent')),
              h('button', { className: 'skg-btn', onClick: () => setBrowse(null) }, t('cancel')),
            ),
          ),
        )
      }

      /* ---------------- 组装 ---------------- */
      const renderRenameDialog = () => {
        if (!renameDialog) return null
        return h(
          'div',
          { className: 'skg-overlay', onClick: () => setRenameDialog(null) },
          h(
            'div',
            { className: 'skg-modal', onClick: (e) => e.stopPropagation() },
            h('h3', null, t('renameSkillTitle') + '：' + renameDialog.name),
            h('div', { className: 'skg-hint' }, t('renameSkillHint')),
            h('input', {
              className: 'skg-input',
              autoFocus: true,
              value: renameDialog.value,
              spellCheck: false,
              onChange: (e) => setRenameDialog(Object.assign({}, renameDialog, { value: e.target.value, error: null })),
              onKeyDown: (e) => {
                if (e.key === 'Enter') submitRename()
              },
            }),
            renameDialog.error ? h('div', { className: 'skg-fieldError' }, renameDialog.error) : null,
            h(
              'div',
              { className: 'skg-modalActions' },
              h(
                'button',
                {
                  className: 'skg-btn skg-btn-primary',
                  disabled: renameDialog.busy,
                  onClick: submitRename,
                },
                t('ok'),
              ),
              h('button', { className: 'skg-btn', onClick: () => setRenameDialog(null) }, t('cancel')),
            ),
          ),
        )
      }

      const checkedList = [...checked]
      const activeSkill = filtered.find((s) => s.name === activeName) || skills.find((s) => s.name === activeName) || null

      const header = h(
        'div',
        { className: 'skg-head' },
        h('div', { className: 'skg-title' }, iconBook(17), h('span', null, t('panel')), h('small', null, state.data ? t('count', { n: skills.length }) : '')),
        h('div', { className: 'skg-spacer' }),
        h(
          'label',
          { className: 'skg-search', title: t('searchTitle') },
          iconSearch(13),
          h('input', { ref: searchRef, value: query, placeholder: t('search'), 'aria-label': t('search'), onChange: (e) => setQuery(e.target.value) }),
          h('kbd', null, '/'),
        ),
        h(
          'select',
          {
            className: 'skg-select',
            value: cwd,
            title: t('workspaceTitle'),
            'aria-label': t('workspaceTitle'),
            onChange: (e) => {
              const next = e.target.value
              setCwd(next)
              try {
                if (next) window.localStorage.setItem(LS_CWD, next)
                else window.localStorage.removeItem(LS_CWD)
              } catch {
                /* 隐私模式忽略 */
              }
            },
          },
          h('option', { value: '' }, t('workspaceNone')),
          workspaces.map((w) => h('option', { key: w.id, value: w.path }, w.title + ' — ' + w.path)),
        ),
        legacyHost ? null : h('button', { className: 'skg-btn', onClick: () => setDirOpen(true), title: t('dirsTitle') }, iconFolder(13), t('dirsButton')),
        h('button', { className: 'skg-btn', onClick: rescan, title: t('refresh') }, iconReload(13), t('refresh')),
      )

      const chips = h(
        'div',
        { className: 'skg-chips' },
        h('button', { className: 'skg-chip', 'data-active': String(!sourceFilter), onClick: () => setSourceFilter('') }, t('all', { n: skills.length })),
        sources.map((s) => {
          const key = sourceKey(s.key)
          return h(
            'button',
            {
              key: s.key,
              className: 'skg-chip',
              'data-active': String(sourceFilter === s.key),
              onClick: () => setSourceFilter(sourceFilter === s.key ? '' : s.key),
            },
            (key ? t(key) : s.key) + ' ' + s.count,
          )
        }),
        h('div', { className: 'skg-spacer' }),
        h('span', { className: 'skg-count' }, filtered.length + ' / ' + skills.length),
      )

      const banner = legacyHost
        ? h('div', { className: 'skg-banner' }, h('b', null, t('legacyHost')), h('span', null, '　' + t('legacyHostHint')))
        : null

      const selectionBar =
        checkedList.length > 0
          ? h(
              'div',
              { className: 'skg-bar' },
              h('span', null, t('selected', { n: checkedList.length })),
              h(
                'button',
                {
                  className: 'skg-btn',
                  onClick: () => {
                    for (const name of checkedList) download(name)
                    notify(t('downloadStarted', { n: checkedList.length }))
                  },
                },
                iconDownload(13),
                t('batchDownload'),
              ),
              h(
                'button',
                {
                  className: 'skg-btn',
                  disabled: !cwd || legacyHost,
                  onClick: async () => {
                    for (const name of checkedList) await install(name)
                  },
                },
                iconFolder(13),
                t('copyToProject'),
              ),
              h(
                'button',
                {
                  className: 'skg-btn',
                  disabled: legacyHost,
                  onClick: (e) => {
                    const folders = lib.folders.slice().sort((a, b) => (a.order || 0) - (b.order || 0))
                    setMenu({
                      x: e.clientX,
                      y: e.clientY,
                      title: t('moveToFolder'),
                      items: [
                        ...folders.map((f) => ({ key: f.id, label: f.name, onClick: () => assign(checkedList, f.id) })),
                        ...(folders.length ? [{ key: 'sep', type: 'sep' }] : []),
                        { key: 'none', label: t('moveToUngrouped'), onClick: () => assign(checkedList, null) },
                      ],
                    })
                  },
                },
                t('moveToFolder'),
              ),
              h('button', { className: 'skg-btn', onClick: () => setChecked(new Set()) }, t('clearSelection')),
            )
          : null

      let listBody
      if (state.loading) {
        listBody = h('div', { className: 'skg-empty' }, h('span', { className: 'skg-spin' }), h('span', null, t('loading')))
      } else if (state.error) {
        listBody = h(
          'div',
          { className: 'skg-empty' },
          h('span', { className: 'skg-err' }, t('readFailed', { message: state.error })),
          h('button', { className: 'skg-btn', onClick: () => load(cwd) }, t('retry')),
        )
      } else if (!state.data || state.data.skillsAvailable === false) {
        listBody = h(
          'div',
          { className: 'skg-empty' },
          h('span', { className: 'skg-warn' }, t('skillsUnavailable')),
          h('span', { className: 'skg-hint' }, t('skillsUnavailableHint')),
        )
      } else if (filtered.length === 0 && lib.folders.length === 0) {
        listBody = h('div', { className: 'skg-empty' }, h('span', null, skills.length ? t('noMatch') : t('noSkills')))
      } else {
        listBody = h(
          'div',
          null,
          groups.map((group) =>
            h(
              'div',
              { key: 'g-' + (group.id || 'none') },
              renderFolderHeader(group),
              collapsed.has(group.id) ? null : h('div', { className: 'skg-rows' }, group.skills.map(renderRow)),
            ),
          ),
          legacyHost
            ? null
            : creating
              ? h(
                  'div',
                  { className: 'skg-newfolder' },
                  iconPlus(12),
                  h('input', {
                    autoFocus: true,
                    placeholder: t('newFolderPlaceholder'),
                    onBlur: (e) => (e.target.value.trim() ? createFolder(e.target.value) : setCreating(false)),
                    onKeyDown: (e) => {
                      if (e.key === 'Enter') createFolder(e.target.value)
                      if (e.key === 'Escape') setCreating(false)
                    },
                  }),
                )
              : h('div', { className: 'skg-newfolder', onClick: () => setCreating(true) }, iconPlus(12), t('newFolder')),
        )
      }

      let detailBody
      if (!activeSkill) {
        detailBody = h(
          'div',
          { className: 'skg-empty' },
          h('span', null, t('pickSkill')),
          h('span', { className: 'skg-hint' }, t('pickSkillHint')),
          legacyHost ? null : h('span', { className: 'skg-hint' }, t('dragHint')),
        )
      } else if (detail.loading) {
        detailBody = h('div', { className: 'skg-empty' }, h('span', { className: 'skg-spin' }), h('span', null, t('detailLoading')))
      } else if (detail.error) {
        detailBody = h('div', { className: 'skg-empty' }, h('span', { className: 'skg-err' }, detail.error))
      } else {
        const skill = detail.data.skill
        const files = detail.data.files || []
        detailBody = h(
          'div',
          { className: 'skg-detail' },
          h('h2', null, skill.name),
          h('p', null, skill.description || t('noDescription')),
          skill.whenToUse ? h('p', null, t('whenToUse', { text: skill.whenToUse })) : null,
          h(
            'div',
            { className: 'skg-actions' },
            h(
              'button',
              { className: 'skg-btn skg-btn-primary', onClick: () => useSkill(skill.name, notify, t, inputActionsRef.current), title: t('useTitle', { name: skill.name }) },
              iconSend(13),
              t('use'),
            ),
            h('button', { className: 'skg-btn', onClick: () => download(skill.name), title: t('downloadTitle') }, iconDownload(13), t('download')),
            h(
              'button',
              {
                className: 'skg-btn',
                disabled: !cwd,
                title: cwd ? t('copyToProjectTitle') : t('selectWorkspaceFirst'),
                onClick: () => install(skill.name),
              },
              iconFolder(13),
              t('copyToProject'),
            ),
            h(
              'button',
              {
                className: 'skg-btn',
                onClick: () => copyText(skill.invocable || '/' + skill.name, notify, t('copiedInvocation'), t('copyFailed', { text: '/' + skill.name })),
              },
              iconCopy(13),
              t('copyInvocation'),
            ),
            h(
              'button',
              {
                className: 'skg-btn',
                disabled: !detail.data.dir && !skill.path,
                title: t('revealTitle'),
                onClick: () => revealSkill(skill.name),
              },
              iconReveal(13),
              t('reveal'),
            ),
          ),
          h(
            'div',
            { className: 'skg-meta' },
            h('span', null, t('source')),
            h('span', null, (sourceKey(skill.source) ? t(sourceKey(skill.source)) : skill.source) + '（' + skill.source + '）'),
            h('span', null, t('provider')),
            h('span', null, skill.provider || t('sourceUnknown')),
            h('span', null, t('path')),
            h('code', null, skill.path || detail.data.dir || t('noLocalPath')),
            h('span', null, t('invocation')),
            h('code', null, '/' + skill.name),
          ),
          files.length
            ? h(
                'div',
                { className: 'skg-files' },
                files.map((file) =>
                  h(
                    'button',
                    {
                      key: file.path,
                      className: 'skg-file',
                      'data-active': String(!!detail.file && detail.file.path === file.path),
                      onClick: () => openFile(skill.name, file.path),
                      title: formatSize(file.size),
                    },
                    file.path,
                  ),
                ),
              )
            : null,
          detail.fileLoading
            ? h('div', { className: 'skg-empty' }, h('span', { className: 'skg-spin' }))
            : detail.file
              ? h('pre', { className: 'skg-pre' }, detail.file.binary ? t('binaryFile', { size: formatSize(detail.file.size) }) : detail.file.text)
              : h('pre', { className: 'skg-pre' }, detail.data.skill.content || t('noContent')),
        )
      }

      return h(
        'div',
        { className: 'skg-root', onContextMenu: (e) => e.preventDefault() },
        header,
        banner,
        chips,
        selectionBar,
        h('div', { className: 'skg-hair' }),
        h(
          'div',
          { className: 'skg-body' },
          h('div', { className: 'skg-list' }, listBody),
          h('div', { style: { flex: '1 1 auto', minWidth: 0, display: 'flex' } }, detailBody),
        ),
        renderDirDialog(),
        renderBrowseDialog(),
        renderRenameDialog(),
        renderMenu(),
        toast ? h('div', { className: 'skg-toast' }, toast) : null,
      )
    }

    /* ---------------------------------------------------------------- *
     * 对话输入区的「Skill」菜单（多选 → 插入调用）
     * ---------------------------------------------------------------- */
    function SkillComposerMenu(props) {
      const t = props && typeof props.t === 'function' ? props.t : fallbackT
      const [open, setOpen] = React.useState(false)
      const [loading, setLoading] = React.useState(false)
      const [error, setError] = React.useState('')
      const [data, setData] = React.useState(null)
      const [query, setQuery] = React.useState('')
      const [checked, setChecked] = React.useState(() => new Set())
      const [anchor, setAnchor] = React.useState({ left: 0, top: 0 })
      const [hint, setHint] = React.useState('')
      const btnRef = React.useRef(null)
      const hintTimer = React.useRef(null)

      React.useEffect(() => {
        const actions = props && props.inputActions
        if (actions) inputActionsRef.current = actions
        return () => {
          // 输入区卸载（例如切到面板）后旧句柄失效，清掉避免误用
          if (inputActionsRef.current === actions) inputActionsRef.current = null
        }
      }, [props])

      const flash = React.useCallback((message) => {
        setHint(message)
        if (hintTimer.current) window.clearTimeout(hintTimer.current)
        hintTimer.current = window.setTimeout(() => setHint(''), 3600)
      }, [])

      React.useEffect(
        () => () => {
          if (hintTimer.current) window.clearTimeout(hintTimer.current)
        },
        [],
      )

      const close = React.useCallback(() => {
        setOpen(false)
        setQuery('')
        setError('')
      }, [])

      React.useEffect(() => {
        if (!open) return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') close()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [open, close])

      const toggle = async () => {
        if (open) {
          close()
          return
        }
        const rect = btnRef.current ? btnRef.current.getBoundingClientRect() : null
        setAnchor(rect ? { left: rect.left, bottom: rect.bottom, top: rect.top } : { left: 120, bottom: 120, top: 80 })
        setOpen(true)
        setLoading(true)
        setError('')
        try {
          const cwd = (() => {
            try {
              return window.localStorage.getItem(LS_CWD) || ''
            } catch {
              return ''
            }
          })()
          const payload = await fetchJson(API + '/state' + (cwd ? '?cwd=' + encodeURIComponent(cwd) : ''))
          setData(payload)
        } catch (err) {
          setError(String((err && err.message) || err))
        } finally {
          setLoading(false)
        }
      }

      const skills = (data && data.skills) || []
      const folders = ((data && data.library && data.library.folders) || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0))
      const assignments = (data && data.library && data.library.assignments) || {}
      const libraryAvailable = !!(data && data.library)

      const filtered = React.useMemo(() => {
        const needle = query.trim().toLowerCase()
        if (!needle) return skills
        return skills.filter(
          (s) => s.name.toLowerCase().includes(needle) || (s.description || '').toLowerCase().includes(needle),
        )
      }, [skills, query])

      const groups = React.useMemo(() => {
        if (!libraryAvailable) return [{ id: NONE, name: '', color: null, skills: filtered }]
        const buckets = new Map(folders.map((f) => [f.id, []]))
        const loose = []
        for (const skill of filtered) {
          const fid = assignments[skill.name]
          if (fid && buckets.has(fid)) buckets.get(fid).push(skill)
          else loose.push(skill)
        }
        const out = folders
          .map((f) => ({ id: f.id, name: f.name, color: f.color, skills: buckets.get(f.id) || [] }))
          .filter((g) => g.skills.length > 0)
        if (loose.length) out.push({ id: NONE, name: t('ungrouped'), color: null, skills: loose })
        return out
      }, [filtered, folders, assignments, libraryAvailable, t])

      const toggleChecked = (name) => {
        setChecked((prev) => {
          const next = new Set(prev)
          if (next.has(name)) next.delete(name)
          else next.add(name)
          return next
        })
      }

      const insert = () => {
        const names = [...checked]
        if (!names.length) return
        useSkills(names, flash, t, props && props.inputActions)
        setChecked(new Set())
        close()
      }

      const btn = h(
        'button',
        {
          ref: btnRef,
          type: 'button',
          className: 'skg-cmBtn',
          'data-open': String(open),
          title: t('composerTitle'),
          'aria-label': t('composerMenu'),
          'aria-expanded': String(open),
          onClick: toggle,
        },
        iconBook(14),
        h('span', null, t('composerMenu')),
        checked.size ? h('span', { className: 'skg-cmGroup' }, checked.size) : null,
      )

      if (!open) {
        return h(
          'span',
          { className: 'skg-cmWrap' },
          btn,
          hint ? h('div', { className: 'skg-cmHint', style: { left: anchor.left + 'px', bottom: Math.max(8, window.innerHeight - anchor.top + 8) + 'px' } }, hint) : null,
        )
      }

      const popLeft = Math.max(8, Math.min(anchor.left || 8, window.innerWidth - 392))
      const popBottom = Math.max(8, window.innerHeight - (anchor.top || window.innerHeight) + 8)

      return h(
        'span',
        { className: 'skg-cmWrap' },
        btn,
        h('div', { style: { position: 'fixed', inset: 0, zIndex: 89 }, onClick: close, onContextMenu: (e) => { e.preventDefault(); close() } }),
        h(
          'div',
          { className: 'skg-cmPop', style: { left: popLeft + 'px', bottom: popBottom + 'px' } },
          h(
            'div',
            { className: 'skg-cmHead' },
            h('span', { className: 'skg-cmTitle' }, t('composerTitle')),
            h('button', { type: 'button', className: 'skg-cmBtn', onClick: close }, '✕'),
          ),
          h(
            'label',
            { className: 'skg-search', style: { width: '100%' } },
            iconSearch(13),
            h('input', { value: query, placeholder: t('composerSearch'), onChange: (e) => setQuery(e.target.value) }),
          ),
          loading
            ? h('div', { className: 'skg-empty', style: { height: '80px' } }, h('span', { className: 'skg-spin' }))
            : error
              ? h('div', { className: 'skg-empty', style: { height: '80px' } }, h('span', { className: 'skg-err' }, t('readFailed', { message: error })))
              : h(
                  'div',
                  { className: 'skg-cmList' },
                  skills.length === 0
                    ? h('div', { className: 'skg-empty', style: { height: '60px' } }, h('span', null, t('composerEmpty')))
                    : groups.length === 0
                      ? h('div', { className: 'skg-empty', style: { height: '60px' } }, h('span', null, t('noMatch')))
                      : groups.map((group) =>
                          h(
                            'div',
                            { key: 'cm-' + (group.id || 'none') },
                            group.name
                              ? h(
                                  'div',
                                  { className: 'skg-cmGroup' },
                                  h('span', { className: 'skg-cmGroupDot', style: group.color ? { background: group.color } : undefined }),
                                  h('span', null, group.name),
                                  h('span', null, '· ' + group.skills.length),
                                )
                              : null,
                            group.skills.map((skill) =>
                              h(
                                'label',
                                { key: skill.name, className: 'skg-cmRow' },
                                h('input', {
                                  type: 'checkbox',
                                  className: 'skg-cmCheck',
                                  checked: checked.has(skill.name),
                                  'aria-label': t('select', { name: skill.name }),
                                  onChange: () => toggleChecked(skill.name),
                                }),
                                h(
                                  'span',
                                  { className: 'skg-cmMain' },
                                  h('span', { className: 'skg-cmName' }, skill.name),
                                  h('span', { className: 'skg-cmDesc' }, skill.description || t('noDescription')),
                                ),
                              ),
                            ),
                          ),
                        ),
                ),
          h(
            'div',
            { className: 'skg-cmFoot' },
            h('span', null, t('composerSelected', { n: checked.size })),
            h('button', { type: 'button', className: 'skg-btn', onClick: () => setChecked(new Set()) }, t('composerClear')),
            h('div', { className: 'skg-spacer' }),
            h('button', { type: 'button', className: 'skg-btn skg-btn-primary', disabled: !checked.size, onClick: insert }, t('composerInsert')),
          ),
          h('div', { className: 'skg-hint' }, t('composerHint')),
        ),
        hint ? h('div', { className: 'skg-cmHint', style: { left: popLeft + 'px', bottom: Math.max(8, popBottom - 44) + 'px' } }, hint) : null,
      )
    }

    /** 侧边栏图标：owner 传入 { size, active }。 */
    function SkillGogoIcon(props) {
      const size = (props && props.size) || 18
      return h('span', { style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center' } }, iconBook(size))
    }

    /* ---------------------------------------------------------------- *
     * 注册
     * ---------------------------------------------------------------- */
    const inject = ['slots', 'locale']

    function apply(ctx) {
      ctx.effect(() => {
        const tag = insertStyle()
        return () => {
          if (tag && tag.parentNode) tag.parentNode.removeChild(tag)
        }
      }, 'skill-gogo: styles')
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'skill-gogo: dictionaries')

      const t = ctx.locale.bind(NS)

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => t('panel'), locale: NS }, SkillGogoIcon),
      )
      ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: () => ({ t, clientContext: ctx }) }, SkillGogoPanel),
      )
      // 对话输入区左侧的「Skill」菜单：多选 skill → 插入 `/name` 调用
      ctx.slots.inject('conversation.input.left', () =>
        ctx.slots.register(
          { name: 'conversation.input.left', id: PANEL_ID, order: 20, locale: NS, inject: () => ({ t }) },
          SkillComposerMenu,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
