# EasyWatermark Web

照片印框工具的网页版：在原图外扩展背景，加上模糊或纯色底、圆角、阴影与相机参数文字，
批量输出适合展示和分享的 JPEG 成品。

功能与渲染参数对照 `EasyWatermark`（SwiftUI 原生版）与壹印（yiyin）实现，纯前端、无构建步骤，
照片不会上传到任何服务器。

## 运行

直接用 **Chrome** 打开 `index.html` 即可。导出依赖 File System Access API 把成品图
直接写进你选的文件夹，其他浏览器会显示「请用 Chrome 打开」的提示页，不提供降级下载。
也可以起一个本地静态服务器：

```sh
cd WebWatermark
python3 -m http.server 8080
# 打开 http://localhost:8080
```

> `file://` 与 `http://localhost` 下全部功能可用，不需要安装、不需要联网。

## 部署到 GitHub Pages

仓库：<https://github.com/zhouhang95/WebWatermark>，全是静态文件、没有构建步骤。

首次部署：仓库 Settings → Pages → Source 选「Deploy from a branch」，分支 `main`、目录 `/ (root)`，保存。
约一分钟后线上地址为 <https://zhouhang95.github.io/WebWatermark/>。

之后更新只需：

```sh
git add -A && git commit -m "说明这次改了什么" && git push
```

- Pages 强制 HTTPS，属于安全上下文，File System Access API 与本地打开时行为一致，导出正常。
- 免费账号的 Pages 要求仓库 public；本项目为 GPL-3.0，公开无碍。
- 已放 `.nojekyll`，跳过 Jekyll 处理，文件原样发布；所有资源均用相对路径，可部署在子路径下。
- `localStorage` 按 origin 隔离：从 `file://` 换到 `github.io` 后参数会恢复默认一次。
- 仍然只有 Chrome 能用；手机浏览器（包括 iOS 上的 Chrome）没有目录写入能力，会看到提示页。

## 使用

1. 点击「添加照片」，或把图片拖进窗口；支持多选。
2. 左侧列表选择照片，中间实时查看印框效果。
3. 右侧调整主图占比、圆角、阴影、背景、输出比例和 JPEG 质量。
4. 「文字模板」「字段设置」编辑拍摄信息、签名与自定义字段。
5. 点击「生成印框」：首次会要求选择输出文件夹，之后直接写入该文件夹。
6. 再次导出遇到同名文件会生成 `-1`、`-2` 后缀，不覆盖已有图片。

快捷键：`Ctrl/⌘ + O` 添加照片，`Ctrl/⌘ + E` 生成印框。

## 功能

- **印框参数**：主图占比、最小上下边距、文字间距、指定输出比例（含 1:1 / 4:5 / 16:9 预设）、
  竖图转横屏、圆角、阴影、纯色背景与背景模糊、品牌 Logo 开关、JPEG 质量。
- **文字模板**：`{字段键}` 占位符，`{A|B}` 表示优先 A、缺失时用 B；支持启用、排序、字体、
  字号（按背景高度百分比）、粗体、斜体、大小写、自定义颜色、Logo 垂直居中。
- **字段**：15 个内置相机字段，可隐藏、可用自定义值覆盖（或仅补缺失值）、
  可换成图片（区分亮色 / 暗色背景两版）、可单独覆盖字体。支持新增自定义字段。
- **品牌 Logo**：Canon、Nikon、Sony、Fujifilm、Leica、Hasselblad、DJI、Ricoh、Pentax、
  Sigma、Olympus、Panasonic、Songdian，按 `Make` 自动匹配并按文字颜色着色。
- **预览**：参数变化 300ms 防抖，过期结果自动丢弃；渲染沿用与导出相同的合成流程。
- **导出**：批量串行处理，列表显示每张进度与结果，可中途停止。
- **持久化**：参数、模板、字段保存在浏览器 localStorage，下次打开自动恢复。

## 与原生版的差异

| 项目 | 原生版 (macOS) | 网页版 |
| --- | --- | --- |
| 图像处理 | Core Image / Core Graphics | Canvas 2D |
| EXIF | ImageIO 通用字段 | exifr 解析 |
| 背景模糊 | `CIGaussianBlur` | `ctx.filter: blur()`，半径按约 1:2 折算，视觉效果接近但不保证像素一致 |
| 输出位置 | 安全作用域目录书签 | File System Access API（仅 Chrome） |
| 字体 | 系统字体 + 导入 TTF/OTF（进程内注册） | 系统字体 + `FontFace` 导入（读取字体 name 表获取家族名） |
| 元数据 | 仅保留 DPI | Canvas 编码，不写入 DPI 与原始 EXIF |
| 拍摄档位 / 测光 / 白平衡 | 输出 EXIF 原始数值 | 输出可读中文（手动、评价测光…） |

其余布局算法（背景尺寸推导、主图占比、文字间距、底部留白 0.027×背景高）与原生版一致，
`canon2.JPG` 在默认参数下同样输出 4447×2965。

## 源码结构

```
index.html          界面骨架
css/style.css       样式（含深色模式）
js/model.js         默认参数、模板、字段、localStorage 持久化
js/exif.js          EXIF 读取与字段格式化
js/render.js        Canvas 渲染：布局、模糊背景、圆角阴影、图文混排、JPEG 编码
js/editors.js       文字模板 / 字段 / 照片信息弹窗
js/app.js           照片列表、预览调度、参数面板绑定、批量导出
js/logos.js         品牌 SVG（内联为 data URI，便于着色且不污染 canvas）
js/vendor/          exifr 7.1.3
brand/              品牌 SVG 原始文件
```

## 已知限制

- HEIC/HEIF 取决于浏览器解码能力，多数浏览器无法直接读取。
- 单边上限 16384 像素、总像素 1.6 亿，超出会提示调整参数。
- 仅支持 Chrome：导出用到的文件夹写入 API 目前只有 Chromium 内核提供，没有 ZIP 降级路径。
- 文件夹输出句柄不跨刷新保存，刷新后需重新选择文件夹。

来源与许可见 `NOTICE.md`、`LICENSE`。
