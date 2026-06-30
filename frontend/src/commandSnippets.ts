// ─────────────────────────────────────────────────────────────
// Lynx · 终端命令片段库（命令自动补全）
// 用户在终端输入时，按缓冲前缀 / 关键字匹配命令片段并给出补全建议。
// 例：输入 g 提示 git log；输入 dps 提示 docker ps -a。
// 片段持久化于 localStorage，可在「命令库」弹窗中自定义增删改。
// ─────────────────────────────────────────────────────────────

export interface CmdSnippet {
  id: string;
  /** 要插入终端的完整命令 */
  cmd: string;
  /** 可选短别名 / 缩写，用于快速触发（如 g → git log） */
  keyword?: string;
  /** 可选中文说明，仅用于下拉提示展示 */
  desc?: string;
}

const STORAGE_KEY = 'term_cmd_snippets';

// 内置默认片段：覆盖 Linux 日常运维绝大多数高频命令。
// [关键字, 命令, 说明]，关键字为可选短别名（留空则仅按命令前缀 / 子串匹配）。
type RawSnippet = [string, string, string];

const RAW_SNIPPETS: RawSnippet[] = [
  // ── 文件与目录 ──────────────────────────────
  ['ll', 'ls -alh', '详细列表'],
  ['la', 'ls -A', '含隐藏文件'],
  ['lt', 'ls -alht', '按时间排序'],
  ['lsz', 'ls -alhS', '按大小排序'],
  ['tree', 'tree -L 2', '目录树'],
  ['mkp', 'mkdir -p ', '递归建目录'],
  ['cpr', 'cp -r ', '递归复制'],
  ['', 'mv ', '移动/重命名'],
  ['lns', 'ln -s ', '创建软链接'],
  ['rmrf', 'rm -rf ', '⚠️ 强制递归删除'],
  ['', 'pwd', '当前路径'],
  ['', 'stat ', '文件详情'],
  ['', 'file ', '文件类型'],
  ['', 'touch ', '创建空文件'],
  ['', 'realpath ', '绝对路径'],
  ['', 'basename ', '取文件名'],
  ['', 'dirname ', '取目录名'],
  ['rsync', 'rsync -avz --progress ', '增量同步'],

  // ── 文本查看与处理 ──────────────────────────
  ['', 'cat ', '查看文件'],
  ['', 'less ', '分页查看'],
  ['head', 'head -n 50 ', '看头部'],
  ['tail', 'tail -n 100 ', '看尾部'],
  ['tf', 'tail -f ', '实时跟踪'],
  ['grep', 'grep -rn ', '递归搜索'],
  ['grepi', 'grep -rin ', '忽略大小写搜索'],
  ['', 'grep -v ', '反向过滤'],
  ['', "sed -n '1,50p' ", '打印指定行'],
  ['', "sed -i 's/old/new/g' ", '原地替换'],
  ['', "awk '{print $1}' ", '取列'],
  ['', 'sort -u ', '排序去重'],
  ['', 'uniq -c ', '计数去重'],
  ['wcl', 'wc -l ', '统计行数'],
  ['', 'cut -d: -f1 ', '按分隔取列'],
  ['', 'diff ', '比较文件'],
  ['', 'xargs ', '参数传递'],
  ['', 'tee ', '同时输出文件'],
  ['', 'column -t', '对齐成列'],
  ['', 'jq . ', '格式化 JSON'],

  // ── 查找 ────────────────────────────────────
  ['find', 'find . -name "*" ', '按名查找'],
  ['', 'find . -type f -mtime -1', '一天内修改的文件'],
  ['', 'find . -size +100M', '大于100M的文件'],
  ['', 'find . -type f -exec ls -lh {} \\;', '查找并列出'],
  ['', 'which ', '命令路径'],
  ['', 'whereis ', '定位命令/手册'],
  ['', 'locate ', '索引查找'],

  // ── 权限与归属 ──────────────────────────────
  ['chx', 'chmod +x ', '加可执行'],
  ['', 'chmod 755 ', '设权限755'],
  ['', 'chmod -R 644 ', '递归设权限'],
  ['chr', 'chown -R ', '递归改属主'],
  ['', 'chgrp -R ', '改属组'],
  ['', 'umask', '默认权限掩码'],
  ['', 'getfacl ', '查看ACL'],
  ['', 'setfacl -m u:user:rwx ', '设置ACL'],

  // ── 进程管理 ────────────────────────────────
  ['psa', 'ps aux', '全部进程'],
  ['pg', 'ps aux | grep ', '进程查找'],
  ['psf', 'ps -ef | grep ', '进程查找(ef)'],
  ['', 'pgrep -a ', '按名找PID'],
  ['', 'pkill -f ', '按名杀进程'],
  ['k9', 'kill -9 ', '强制杀进程'],
  ['', 'killall ', '按名全杀'],
  ['top', 'top', '实时进程'],
  ['htop', 'htop', '增强top'],
  ['', 'nohup  &', '后台不挂断运行'],
  ['', 'jobs -l', '后台任务'],
  ['lsofi', 'lsof -i ', '端口占用进程'],
  ['lsofp', 'lsof -p ', '进程打开文件'],
  ['', 'fuser -v ', '占用查询'],
  ['', 'strace -f -p ', '系统调用跟踪'],
  ['', 'renice -n 10 -p ', '调整优先级'],

  // ── 系统资源与监控 ──────────────────────────
  ['fr', 'free -h', '内存使用'],
  ['', 'vmstat 1', '虚拟内存统计'],
  ['', 'iostat -x 1', 'IO统计'],
  ['', 'mpstat -P ALL 1', 'CPU各核统计'],
  ['', 'pidstat 1', '进程级资源'],
  ['', 'sar -u 1 5', '历史性能采样'],
  ['up', 'uptime', '负载与运行时长'],
  ['', 'w', '登录用户与负载'],
  ['', 'dmesg -T | tail -n 50', '内核日志'],
  ['watch', 'watch -n 1 ', '定时重复执行'],
  ['', 'nproc', 'CPU核数'],

  // ── 磁盘与文件系统 ──────────────────────────
  ['df', 'df -h', '磁盘使用'],
  ['dfi', 'df -i', 'inode使用'],
  ['du', 'du -sh * | sort -h', '目录大小排序'],
  ['', 'du -ah . | sort -h | tail -n 20', '最大文件Top20'],
  ['', 'lsblk', '块设备列表'],
  ['', 'blkid', '分区UUID'],
  ['', 'mount | column -t', '已挂载文件系统'],
  ['', 'findmnt', '挂载树'],
  ['', 'fdisk -l', '分区表'],
  ['', 'ncdu', '交互式磁盘分析'],

  // ── 网络 ────────────────────────────────────
  ['ipa', 'ip a', '网卡地址'],
  ['ipr', 'ip r', '路由表'],
  ['nt', 'netstat -tulnp', '端口监听(netstat)'],
  ['sst', 'ss -tulnp', '端口监听(ss)'],
  ['', 'ss -s', '连接统计'],
  ['ping', 'ping -c 4 ', '连通性测试'],
  ['', 'traceroute ', '路由追踪'],
  ['', 'mtr ', '实时路由质量'],
  ['curl', 'curl -sS -i ', '请求并看响应头'],
  ['', 'curl -o /dev/null -s -w "%{http_code} %{time_total}s\\n" ', '测响应码/耗时'],
  ['', 'wget ', '下载文件'],
  ['dig', 'dig ', 'DNS解析'],
  ['', 'nslookup ', '域名查询'],
  ['', 'nc -zv  ', '端口探测'],
  ['', 'tcpdump -i any -nn ', '抓包'],
  ['', 'iptables -L -n -v', '防火墙规则'],
  ['', 'arp -n', 'ARP表'],
  ['scp', 'scp  user@host:/path', '远程拷贝'],

  // ── 用户与组 ────────────────────────────────
  ['', 'whoami', '当前用户'],
  ['', 'id ', '用户ID与组'],
  ['', 'su - ', '切换用户'],
  ['', 'useradd -m ', '新建用户'],
  ['', 'usermod -aG ', '加入附加组'],
  ['', 'passwd ', '改密码'],
  ['', 'groupadd ', '新建组'],
  ['', 'last -n 20', '最近登录'],
  ['', 'who', '在线用户'],

  // ── 服务 / systemd ──────────────────────────
  ['sts', 'systemctl status ', '服务状态'],
  ['str', 'systemctl restart ', '重启服务'],
  ['sta', 'systemctl start ', '启动服务'],
  ['stp', 'systemctl stop ', '停止服务'],
  ['ste', 'systemctl enable --now ', '开机自启并启动'],
  ['std', 'systemctl disable ', '取消自启'],
  ['', 'systemctl daemon-reload', '重载unit配置'],
  ['', 'systemctl --failed', '失败的服务'],
  ['', 'systemctl list-units --type=service', '服务列表'],
  ['jx', 'journalctl -xe', '系统日志'],
  ['ju', 'journalctl -u  -f', '跟踪服务日志'],
  ['', 'journalctl --since "1 hour ago"', '近1小时日志'],

  // ── 包管理 ──────────────────────────────────
  ['', 'apt update && apt upgrade -y', 'apt 更新升级'],
  ['', 'apt install -y ', 'apt 安装'],
  ['', 'apt remove -y ', 'apt 卸载'],
  ['', 'apt search ', 'apt 搜索'],
  ['', 'dpkg -l | grep ', 'dpkg 已装查询'],
  ['', 'yum install -y ', 'yum 安装'],
  ['', 'yum update -y', 'yum 更新'],
  ['', 'dnf install -y ', 'dnf 安装'],
  ['', 'rpm -qa | grep ', 'rpm 已装查询'],

  // ── 压缩与归档 ──────────────────────────────
  ['tarc', 'tar -czvf archive.tar.gz ', '打包压缩'],
  ['tarx', 'tar -xzvf ', '解包解压'],
  ['tart', 'tar -tzvf ', '查看归档内容'],
  ['', 'zip -r archive.zip ', 'zip 压缩'],
  ['', 'unzip ', 'zip 解压'],
  ['', 'gzip ', 'gzip 压缩'],
  ['', 'gunzip ', 'gzip 解压'],

  // ── Git ─────────────────────────────────────
  ['g', 'git log --oneline --graph --decorate -20', 'Git 提交历史'],
  ['gs', 'git status', 'Git 状态'],
  ['gp', 'git pull', 'Git 拉取'],
  ['gpush', 'git push', 'Git 推送'],
  ['gd', 'git diff', 'Git 差异'],
  ['ga', 'git add .', 'Git 暂存全部'],
  ['gc', 'git commit -m ""', 'Git 提交'],
  ['gco', 'git checkout ', 'Git 切换'],
  ['gb', 'git branch -a', 'Git 分支列表'],
  ['', 'git stash', 'Git 暂存改动'],
  ['', 'git reset --hard ', '⚠️ Git 硬重置'],
  ['', 'git fetch --all --prune', 'Git 拉取所有远端'],
  ['', 'git remote -v', 'Git 远端列表'],

  // ── Docker ──────────────────────────────────
  ['dps', 'docker ps -a', '容器列表'],
  ['di', 'docker images', '镜像列表'],
  ['dl', 'docker logs -f --tail 200 ', '容器日志'],
  ['dex', 'docker exec -it  bash', '进入容器'],
  ['', 'docker stop ', '停止容器'],
  ['', 'docker rm -f ', '删除容器'],
  ['', 'docker rmi ', '删除镜像'],
  ['', 'docker pull ', '拉取镜像'],
  ['', 'docker build -t  .', '构建镜像'],
  ['', 'docker stats', '容器资源监控'],
  ['', 'docker inspect ', '容器详情'],
  ['', 'docker system df', '镜像/容器占用'],
  ['', 'docker system prune -af', '⚠️ 清理无用资源'],
  ['dc', 'docker compose up -d', 'Compose 启动'],
  ['dcd', 'docker compose down', 'Compose 停止'],
  ['dcl', 'docker compose logs -f', 'Compose 日志'],

  // ── Kubernetes ──────────────────────────────
  ['k', 'kubectl get pods -o wide', '查看Pod'],
  ['', 'kubectl get pods -A', '全命名空间Pod'],
  ['', 'kubectl get nodes -o wide', '查看节点'],
  ['', 'kubectl get svc', '查看Service'],
  ['', 'kubectl describe pod ', 'Pod详情'],
  ['kl', 'kubectl logs -f ', 'Pod日志'],
  ['', 'kubectl exec -it  -- bash', '进入Pod'],
  ['', 'kubectl apply -f ', '应用配置'],
  ['', 'kubectl top pods', 'Pod资源占用'],
  ['', 'kubectl get events --sort-by=.lastTimestamp', '集群事件'],

  // ── 防火墙 ──────────────────────────────────
  ['', 'firewall-cmd --list-all', 'firewalld 规则'],
  ['', 'firewall-cmd --add-port=80/tcp --permanent && firewall-cmd --reload', '放行端口'],
  ['', 'ufw status verbose', 'ufw 状态'],
  ['', 'ufw allow ', 'ufw 放行'],

  // ── 计划任务与环境 ──────────────────────────
  ['', 'crontab -l', '查看定时任务'],
  ['', 'crontab -e', '编辑定时任务'],
  ['', 'systemctl list-timers', 'systemd 定时器'],
  ['', 'env', '环境变量'],
  ['', 'echo $PATH', '查看PATH'],
  ['', 'export ', '导出环境变量'],
  ['', 'history', '命令历史'],
  ['', 'source ', '加载脚本'],

  // ── 系统信息 ────────────────────────────────
  ['', 'uname -a', '内核信息'],
  ['', 'hostnamectl', '主机信息'],
  ['', 'lscpu', 'CPU信息'],
  ['', 'lspci', 'PCI设备'],
  ['', 'lsusb', 'USB设备'],
  ['', 'timedatectl', '时间/时区'],
  ['', 'cat /etc/os-release', '系统版本'],
  ['', 'date', '当前时间'],
  ['', 'reboot', '⚠️ 重启系统'],
  ['', 'shutdown -h now', '⚠️ 关机'],

  // ── Git（进阶）─────────────────────────────
  ['gca', 'git commit -am ""', '暂存已跟踪并提交'],
  ['gcm', 'git commit -m ""', '提交并写信息'],
  ['gamend', 'git commit --amend', '修改上次提交'],
  ['gsw', 'git switch ', '切换分支'],
  ['gswc', 'git switch -c ', '新建并切换分支'],
  ['grs', 'git restore ', '撤销工作区改动'],
  ['grss', 'git restore --staged ', '取消暂存'],
  ['gsp', 'git stash pop', '恢复最近暂存'],
  ['gst', 'git stash list', '暂存列表'],
  ['grb', 'git rebase ', '变基'],
  ['grbi', 'git rebase -i HEAD~3', '交互式变基'],
  ['gcp', 'git cherry-pick ', '拣选提交'],
  ['glg', 'git log --oneline --graph --all -30', '全分支图谱'],
  ['gbl', 'git blame ', '逐行追溯'],
  ['gtag', 'git tag -a v1.0.0 -m ""', '打标签'],
  ['greflog', 'git reflog', '引用日志(找回提交)'],
  ['gclean', 'git clean -fd', '⚠️ 清理未跟踪文件'],
  ['gconf', 'git config --global -l', '查看全局配置'],

  // ── Docker（进阶）──────────────────────────
  ['dcp', 'docker compose ps', 'Compose 容器状态'],
  ['dcr', 'docker compose restart ', 'Compose 重启'],
  ['dcb', 'docker compose up -d --build', 'Compose 重建启动'],
  ['dexsh', 'docker exec -it  sh', '进入容器(sh)'],
  ['dcpf', 'docker cp  :', '容器内外拷贝'],
  ['', 'docker restart ', '重启容器'],
  ['', 'docker top ', '容器内进程'],
  ['', 'docker network ls', '网络列表'],
  ['', 'docker volume ls', '卷列表'],
  ['', 'docker image prune -af', '⚠️ 清理悬空镜像'],
  ['', 'docker run --rm -it  bash', '临时容器'],
  ['', 'docker tag  ', '镜像打标'],
  ['', 'docker save  | gzip > image.tar.gz', '导出镜像'],
  ['', 'docker load -i ', '导入镜像'],

  // ── Kubernetes（进阶）─────────────────────
  ['kga', 'kubectl get all -A', '全部资源'],
  ['kgi', 'kubectl get ingress -A', '查看 Ingress'],
  ['kgd', 'kubectl get deploy -o wide', '查看 Deployment'],
  ['kpf', 'kubectl port-forward svc/  8080:80', '端口转发'],
  ['kro', 'kubectl rollout restart deploy/', '滚动重启'],
  ['krs', 'kubectl rollout status deploy/', '发布状态'],
  ['ksc', 'kubectl scale deploy/  --replicas=3', '扩缩容'],
  ['kdp', 'kubectl delete pod ', '删除 Pod'],
  ['kdn', 'kubectl describe node ', '节点详情'],
  ['ktn', 'kubectl top nodes', '节点资源占用'],
  ['kns', 'kubectl config set-context --current --namespace=', '切换命名空间'],
  ['kctx', 'kubectl config get-contexts', '查看上下文'],
  ['kaf', 'kubectl apply -f ', '应用配置'],
  ['kdf', 'kubectl delete -f ', '删除配置'],
  ['kex', 'kubectl exec -it  -- sh', '进入 Pod(sh)'],

  // ── 文本检索（现代工具）────────────────────
  ['rg', 'rg -n ', 'ripgrep 快速搜索'],
  ['rgi', 'rg -ni ', 'ripgrep 忽略大小写'],
  ['fd', 'fd ', 'fd 文件查找'],
  ['bat', 'bat ', '高亮分页查看'],
  ['', "awk -F',' '{print $1,$3}' ", 'awk 按逗号取列'],
  ['', "sed -i '/pattern/d' ", '删除匹配行'],
  ['', "grep -rIl '' .", '列出含匹配的文件'],
  ['', "tr -d '\\r' < dos.txt > unix.txt", '去除回车(CRLF→LF)'],
  ['', "jq '.[] | .name' ", 'jq 取字段'],
  ['', "yq '.spec' ", 'yq 读取 YAML'],

  // ── 网络（进阶）────────────────────────────
  ['', 'ss -tnp state established', '已建立连接'],
  ['', 'ip -s link', '网卡流量统计'],
  ['', 'ip route add  via ', '添加路由'],
  ['', 'dig +short ', 'DNS 简洁解析'],
  ['', 'host ', '域名解析'],
  ['', 'curl -X POST -H "Content-Type: application/json" -d \'{}\' ', 'POST JSON'],
  ['', 'curl -fsSL  | bash', '⚠️ 下载并执行脚本'],
  ['', 'nmap -sS -p 1-1000 ', '端口扫描'],
  ['', 'speedtest-cli', '测网速'],
  ['', 'ethtool ', '网卡参数'],

  // ── SSH / 远程 ─────────────────────────────
  ['', 'ssh-keygen -t ed25519 -C ""', '生成密钥'],
  ['', 'ssh-copy-id user@host', '免密下发公钥'],
  ['', 'ssh -L 8080:localhost:80 user@host', '本地端口转发'],
  ['', 'ssh -D 1080 user@host', 'SOCKS 代理'],
  ['', 'scp -r  user@host:/path', '递归远程拷贝'],
  ['', 'rsync -avzP -e ssh  user@host:/path', 'SSH 增量同步'],

  // ── 证书 / OpenSSL ────────────────────────
  ['', 'openssl x509 -in cert.pem -noout -text', '查看证书'],
  ['', 'openssl x509 -in cert.pem -noout -dates', '证书有效期'],
  ['', 'openssl s_client -connect host:443 -servername host', '探测 TLS'],
  ['', 'openssl req -new -newkey rsa:2048 -nodes -keyout key.pem -out csr.pem', '生成 CSR'],
  ['', 'echo | openssl s_client -connect host:443 2>/dev/null | openssl x509 -noout -dates', '远端证书到期'],

  // ── 数据库 CLI ─────────────────────────────
  ['', 'mysql -u root -p ', 'MySQL 登录'],
  ['', 'mysqldump -u root -p db > db.sql', 'MySQL 备份'],
  ['', 'psql -U postgres -d ', 'PostgreSQL 登录'],
  ['', 'redis-cli -h 127.0.0.1 -p 6379', 'Redis 连接'],
  ['', 'redis-cli info | grep used_memory_human', 'Redis 内存'],
  ['', 'mongosh ', 'MongoDB Shell'],

  // ── 性能 / 排障 ────────────────────────────
  ['', 'iotop -o', 'IO 占用进程'],
  ['', 'dstat -tcmndy 1', '综合资源采样'],
  ['', 'cat /proc/loadavg', '负载快照'],
  ['', 'ps -eo pid,ppid,cmd,%mem,%cpu --sort=-%mem | head', '内存 Top'],
  ['', 'ps -eo pid,cmd,%cpu --sort=-%cpu | head', 'CPU Top'],
  ['', 'tail -f /var/log/syslog', '跟踪系统日志'],
  ['', 'tail -f /var/log/messages', '跟踪系统日志(RHEL)'],
  ['', 'dmesg -wH', '实时内核日志'],

  // ── 终端复用 / 杂项 ────────────────────────
  ['', 'tmux new -s work', '新建 tmux 会话'],
  ['', 'tmux attach -t work', '接入 tmux 会话'],
  ['', 'tmux ls', 'tmux 会话列表'],
  ['', 'screen -S work', '新建 screen'],
  ['', 'timeout 10 ', '限时执行'],
  ['', 'yes | ', '自动确认 y'],
  ['', '!! ', '上一条命令'],
  ['', 'sudo !!', 'sudo 重跑上条'],
  ['', 'cd -', '回上一目录'],
];

const DEFAULT_SNIPPETS: CmdSnippet[] = RAW_SNIPPETS.map(([keyword, cmd, desc], i) => ({
  id: `def-${i}`,
  cmd,
  keyword: keyword || undefined,
  desc: desc || undefined,
}));

let cache: CmdSnippet[] | null = null;

/** 读取当前片段列表（带内存缓存）。损坏或缺失时回退到默认集。 */
export function loadSnippets(): CmdSnippet[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        cache = parsed.filter((s) => s && typeof s.cmd === 'string' && s.cmd.length > 0);
        return cache;
      }
    }
  } catch {
    // ignore，回退默认
  }
  cache = DEFAULT_SNIPPETS;
  return cache;
}

/** 保存片段列表并广播变更，便于各终端窗格热重载。 */
export function saveSnippets(list: CmdSnippet[]): void {
  cache = list;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // ignore 存储配额异常
  }
  window.dispatchEvent(new Event('cmd-snippets-changed'));
}

/** 恢复默认片段集。 */
export function resetSnippets(): CmdSnippet[] {
  cache = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event('cmd-snippets-changed'));
  return DEFAULT_SNIPPETS;
}

export function defaultSnippets(): CmdSnippet[] {
  return DEFAULT_SNIPPETS;
}

// ── 使用频率学习：记录被采纳的命令，匹配时按频率/近期加权 ──────────
const USAGE_KEY = 'term_cmd_usage';
type Usage = Record<string, { n: number; t: number }>;
let usageCache: Usage | null = null;

function loadUsage(): Usage {
  if (usageCache) return usageCache;
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    usageCache = raw ? (JSON.parse(raw) as Usage) : {};
  } catch {
    usageCache = {};
  }
  return usageCache!;
}

/** 记录一次命令采纳，用于后续补全的频率/近期加权。 */
export function recordSnippetUsage(cmd: string): void {
  if (!cmd) return;
  const u = loadUsage();
  const e = u[cmd] || { n: 0, t: 0 };
  e.n += 1;
  e.t = Date.now();
  u[cmd] = e;
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(u));
  } catch {
    /* ignore 配额 */
  }
}

// 命令首字母缩写（含子命令，忽略以 - 开头的选项）：git commit -m → gc
const acronymOf = (cmd: string): string =>
  cmd
    .trim()
    .split(/\s+/)
    .filter((t) => t && !t.startsWith('-'))
    .map((t) => t[0])
    .join('')
    .toLowerCase();

// 模糊子序列：q 的字符按序出现在 target 中即匹配，越紧凑得分越高（2..18），否则 -1
const fuzzyScore = (q: string, target: string): number => {
  if (!q || !target) return -1;
  let ti = 0;
  let first = -1;
  let last = -1;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    for (; ti < target.length; ti++) {
      if (target[ti] === ch) {
        found = ti;
        ti++;
        break;
      }
    }
    if (found < 0) return -1;
    if (first < 0) first = found;
    last = found;
  }
  const span = last - first + 1;
  return Math.max(2, 18 - (span - q.length));
};

/**
 * 按当前输入缓冲智能匹配片段并打分排序，综合：
 *   关键字精确/前缀 > 命令前缀 > 首字母缩写 > 词边界前缀 > 关键字/命令包含 > 模糊子序列 > 说明包含；
 * 并叠加使用频率与近期加权。忽略前导 sudo；按命令去重，返回前 limit 条。
 */
export function matchSnippets(buffer: string, list: CmdSnippet[], limit = 8): CmdSnippet[] {
  const cleaned = buffer.replace(/^\s*sudo\s+/, '');
  const w = cleaned.trim().toLowerCase();
  if (!w) return [];
  const lastTok = w.split(/\s+/).pop() || w;
  const usage = loadUsage();
  const now = Date.now();

  const scored: { s: CmdSnippet; score: number }[] = [];
  for (const s of list) {
    const cmd = s.cmd.toLowerCase();
    if (cmd === w) continue; // 已完整输入
    const kw = (s.keyword || '').toLowerCase();
    const acr = acronymOf(s.cmd);
    const desc = (s.desc || '').toLowerCase();

    let score = -1;
    if (kw && kw === w) score = 100;
    else if (kw && kw.startsWith(w)) score = 92;
    else if (cmd.startsWith(w)) score = 84;
    else if (acr && w.length >= 2 && acr.startsWith(w)) score = 76;
    else if (lastTok.length >= 2 && cmd.split(/\s+/).some((t) => t.startsWith(lastTok))) score = 58;
    else if (kw && kw.includes(w)) score = 42;
    else if (cmd.includes(w)) score = 36;
    else {
      const f = Math.max(fuzzyScore(w, cmd), acr ? fuzzyScore(w, acr) : -1);
      if (f > 0) score = f;
      else if (desc && desc.includes(w)) score = 14;
    }

    if (score < 0) continue;

    const u = usage[s.cmd];
    if (u) {
      score += Math.min(u.n, 25); // 频率加权（上限 25）
      if (now - u.t < 6 * 3600 * 1000) score += 8; // 近 6 小时用过，再加权
    }
    scored.push({ s, score });
  }

  scored.sort((a, b) => b.score - a.score || a.s.cmd.length - b.s.cmd.length);

  const seen = new Set<string>();
  const out: CmdSnippet[] = [];
  for (const { s } of scored) {
    if (seen.has(s.cmd)) continue;
    seen.add(s.cmd);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}
