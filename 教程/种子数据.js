/* 截图演示数据：在页面上下文执行，写 IndexedDB 后返回 ok
 * 仅用于生成教程配图，不进入产品代码 */
(async () => {
  const now = Date.now(), DAY = 86400000;
  /* 1. 清空既有业务数据 */
  for (const s of ['docs', 'questions', 'mistakes', 'practice', 'exams', 'review']) {
    const rows = await DB.all(s);
    for (const r of rows) await DB.del(s, r.id);
  }
  /* 2. 设置：已配置 AI（占位 Key，仅供截图显示"已配置"状态） */
  await DB.kvSet('settings', Object.assign({}, state.settings, {
    apiKey: 'sk-demo-8f3a2c7e1b9d4f60', model: 'deepseek-chat',
    theme: 'light', grading: 'ai', autoRemove: 1, reviewAutoAdd: 1,
    revNewLimit: 20, revLimit: 100, genCount: 5, navWidth: 212, navCollapsed: 0,
  }));

  /* 3. 科目 */
  subjects = [
    { id: 's1', name: '计算机网络', color: '#4f6ef7' },
    { id: 's2', name: '数据库原理', color: '#10b981' },
    { id: 's3', name: '软件工程', color: '#f59e0b' },
  ];
  await saveSubjects();

  /* 4. 文档 */
  const docText1 = `第3章 数据链路层

3.1 使用点对点信道的数据链路层
数据链路层最基本的服务是将源自网络层的数据可靠地传输到相邻节点的网络层。链路是一条无源的点到点物理线路段，中间没有任何交换结点。

3.2 三个基本问题
（1）封装成帧：在一段数据前后分别添加首部和尾部，构成一个帧。帧定界符用于确定帧的界限。
（2）透明传输：无论数据部分出现什么样的比特组合，都应当能够在链路上传送。常用字节填充或比特填充实现。
（3）差错检测：循环冗余检验 CRC 在发送端把数据划分为组，每组末尾添加冗余码 FCS。

3.3 CSMA/CD 协议
以太网采用载波监听多点接入/碰撞检测协议。要点：先听后发、边听边发、冲突停发、随机重发。争用期（碰撞窗口）为 2τ，以太网取 51.2 微秒。

3.4 TCP 的可靠传输
TCP 建立连接采用三次握手，释放连接采用四次挥手。发送方维护拥塞窗口 cwnd，慢开始阶段每经过一个往返时间 cwnd 翻倍（指数增长），到达门限后转入拥塞避免，改为线性增长。`;
  const docText2 = `第4章 数据库安全性

4.1 主键与外键
主键（PRIMARY KEY）唯一标识表中每一行，不允许重复、不允许为 NULL。外键（FOREIGN KEY）引用另一张表的主键，用于保证参照完整性；外键列允许为 NULL，表示尚未关联任何记录。

4.2 事务与 ACID
事务是用户定义的一个数据库操作序列，这些操作要么全做要么全不做。事务具有四个特性：原子性（Atomicity）、一致性（Consistency）、隔离性（Isolation）、持久性（Durability）。

4.3 索引
索引是一种辅助数据结构，常见实现为 B+ 树。在 WHERE 条件列上建立索引可以避免全表扫描，把查找代价从 O(n) 降到 O(log n)。以下情况索引会失效：对列使用函数或表达式、以 % 开头的模糊匹配、隐式类型转换、联合索引不满足最左前缀。

4.4 规范化
第一范式要求属性不可再分；第二范式要求非主属性完全依赖于候选键；第三范式要求非主属性不传递依赖于候选键。`;
  const docText3 = `需求分析要点笔记

一、需求分析的任务
需求分析要回答"系统必须做什么"，输出需求规格说明书。常用工具：用例图、数据流图、状态转换图、数据字典。

二、用例图
用例图从外部参与者视角描述系统功能：参与者（Actor）与用例（Use Case）之间的关联关系，以及用例之间的包含、扩展、泛化关系。它不描述执行顺序，执行顺序由时序图或活动图表达。

三、开发方法
敏捷开发强调"个体与交互高于流程与工具、可工作的软件高于详尽的文档"，通过短迭代持续交付可用版本，以响应变化为优先。

四、测试层次
单元测试针对最小可测单元，通常由开发者编写并在编码阶段完成；集成测试验证模块间接口；系统测试与验收测试由测试人员或用户参与。`;

  const d1 = await DB.add('docs', {
    title: '计算机网络 第3章 数据链路层与 TCP', file_name: '计算机网络-第3章.pdf', file_type: 'pdf',
    file_size: 1284600, content: docText1, page_count: 24, subject_id: 's1', created_at: now - 12 * DAY,
  });
  const d2 = await DB.add('docs', {
    title: '数据库系统概论 第4章 安全性', file_name: '数据库系统概论-第4章.docx', file_type: 'docx',
    file_size: 486400, content: docText2, page_count: 18, subject_id: 's2', created_at: now - 9 * DAY,
  });
  const d3 = await DB.add('docs', {
    title: '软件工程 需求分析章节笔记', file_name: '需求分析笔记.md', file_type: 'md',
    file_size: 12480, content: docText3, page_count: null, subject_id: 's3', created_at: now - 6 * DAY,
  });

  /* 5. 题目 */
  const raw = [
    // ---- 计算机网络 ----
    ['single_choice', 'easy', 'TCP 建立连接时，客户端发送的第一个报文段中，SYN 标志位与序号的作用是？',
      ['A. 请求建立连接并同步初始序号', 'B. 确认对方序号已收到', 'C. 通知对方关闭连接', 'D. 请求重传丢失的报文'],
      'A', 'SYN 置 1 表示请求建立连接，同时携带客户端初始序号 seq=x，供双方同步序号。', '三次握手', d1, 's1',
      'TCP 建立连接采用三次握手，释放连接采用四次挥手。'],
    ['single_choice', 'medium', 'TCP 连接释放时，主动关闭方在 TIME_WAIT 状态等待 2MSL 的主要目的是？',
      ['A. 保证最后一个 ACK 能到达对方', 'B. 加快连接释放速度', 'C. 防止对方重复发送数据', 'D. 等待对方重新建立连接'],
      'A', '2MSL 使主动关闭方能在最后一个 ACK 丢失时重发，并让本连接的旧报文在网络中全部消失，避免影响新连接。', '四次挥手', d1, 's1',
      'TCP 建立连接采用三次握手，释放连接采用四次挥手。'],
    ['true_false', 'easy', '接收窗口越大，发送方可以连续发送而无需等待确认的数据量就越多。',
      null, '正确', '接收窗口 rwnd 限制了发送方未确认数据的上限，窗口越大吞吐能力越强。', '滑动窗口', d1, 's1', null],
    ['fill_blank', 'medium', '子网掩码为 255.255.255.192（即 /26）时，每个子网可分配的主机地址数为 ______ 个。',
      null, '62', '/26 有 6 位主机位，2^6=64，去掉网络地址与广播地址各一个，可用主机地址 62 个。', '子网划分', d1, 's1', null],
    ['multiple_choice', 'medium', '关于以太网 CSMA/CD 协议，下列说法正确的是？（多选）',
      ['A. 发送前先监听信道是否空闲', 'B. 发送过程中持续检测是否发生碰撞', 'C. 检测到碰撞后立即停止发送', 'D. 碰撞后固定等待 51.2 微秒再重发'],
      'A,B,C', 'CSMA/CD 的要点是先听后发、边听边发、冲突停发、随机重发；碰撞后采用二进制指数退避，等待时间是随机值而非固定值。', 'CSMA/CD', d1, 's1', null],
    ['true_false', 'medium', 'IP 数据报的分片可以在中途路由器上重组，以减轻目的主机负担。',
      null, '错误', 'IPv4 规定分片的重组只在最终目的主机进行，中途路由器只做转发，不重组。', 'IP 分片', d1, 's1', null],
    ['short_answer', 'hard', '简述距离向量路由算法与链路状态路由算法的核心区别。',
      null, '距离向量算法中每个路由器只与相邻路由器交换整张路由表（距离向量），收敛慢且可能出现计数到无穷问题；链路状态算法中每个路由器洪泛自己的链路状态，各自用 Dijkstra 计算最短路径树，收敛快、无环路，但需要更多存储与计算。',
      '前者交换"我到各处的距离"，后者交换"我的邻居与链路代价"；前者分布式迭代、后者全局计算。', '路由算法', d1, 's1', null],
    ['single_choice', 'easy', 'HTTPS 服务默认使用的传输层端口号是？',
      ['A. 21', 'B. 80', 'C. 443', 'D. 8080'],
      'C', 'HTTP 默认 80，HTTPS 默认 443，FTP 控制连接默认 21。', '网络端口', d1, 's1', null],
    ['fill_blank', 'medium', 'TCP 慢开始阶段，拥塞窗口 cwnd 每经过一个往返时间 RTT 的增长方式是 ______ 增长。',
      null, '指数', '慢开始阶段 cwnd 每经过一个 RTT 翻倍，呈指数增长；达到慢开始门限后转入拥塞避免，改为线性增长。', '拥塞控制', d1, 's1', null],
    ['true_false', 'easy', 'DNS 的递归查询中，本机 DNS 服务器负责代替客户端逐级查询并返回最终结果。',
      null, '正确', '递归查询由服务器承担全部查询工作并返回最终答案；迭代查询则由服务器返回下一跳地址，由客户端自行继续查询。', 'DNS', d1, 's1', null],
    // ---- 数据库 ----
    ['single_choice', 'easy', '下列关于主键约束的描述，正确的是？',
      ['A. 主键列允许为 NULL', 'B. 主键列的值必须唯一且非空', 'C. 一张表可以有多个主键列组合为多主键', 'D. 主键必须是自增整数'],
      'B', '主键用于唯一标识一行，值必须唯一且不能为 NULL；一张表只能定义一个主键（可以是多列组成的复合主键）。', '主键与外键', d2, 's2',
      '主键（PRIMARY KEY）唯一标识表中每一行，不允许重复、不允许为 NULL。'],
    ['multiple_choice', 'medium', '下列哪些属于事务的 ACID 特性？（多选）',
      ['A. 原子性 Atomicity', 'B. 一致性 Consistency', 'C. 隔离性 Isolation', 'D. 持久性 Durability'],
      'A,B,C,D', 'ACID 即原子性、一致性、隔离性、持久性四项特性的首字母缩写。', '事务 ACID', d2, 's2',
      '事务具有四个特性：原子性、一致性、隔离性、持久性。'],
    ['fill_blank', 'medium', '要统计每门课程的平均分且只显示平均分高于 80 的课程，需要在 GROUP BY 之后使用 ______ 子句。',
      null, 'HAVING', 'WHERE 在分组前过滤行，HAVING 在分组后过滤分组，聚合函数条件必须写在 HAVING 中。', '聚合查询', d2, 's2', null],
    ['short_answer', 'hard', '说明在 WHERE 条件列上建立索引为什么能加速查询，并举出两种索引失效的常见情形。',
      null, '索引（B+ 树）把全表顺序扫描变为按树的层级查找，代价由 O(n) 降为 O(log n)，并可利用有序性直接定位范围边界。常见失效情形：①对索引列使用函数或表达式，如 WHERE YEAR(created_at)=2024；②以 % 开头的模糊匹配，如 LIKE "%网络"；此外隐式类型转换、联合索引不满足最左前缀也会失效。',
      '考查点：B+ 树查找代价 + 最左前缀原则。', '索引优化', d2, 's2',
      '在 WHERE 条件列上建立索引可以避免全表扫描，把查找代价从 O(n) 降到 O(log n)。'],
    ['single_choice', 'medium', '第三范式（3NF）要求关系模式中不存在？',
      ['A. 非主属性对候选键的部分函数依赖', 'B. 非主属性对候选键的传递函数依赖', 'C. 多值依赖', 'D. 属性不可再分的限制'],
      'B', '1NF 要求属性不可再分；2NF 消除非主属性对候选键的部分依赖；3NF 进一步消除传递依赖；BCNF 处理主属性间的依赖。', '范式设计', d2, 's2',
      '第三范式要求非主属性不传递依赖于候选键。'],
    ['true_false', 'medium', '外键列的值可以为 NULL，表示该行尚未关联任何父表记录。',
      null, '正确', '外键约束允许 NULL，NULL 不参与参照完整性检查；只有非空的取值必须存在于父表中。', '主键与外键', d2, 's2',
      '外键列允许为 NULL，表示尚未关联任何记录。'],
    ['multiple_choice', 'medium', '下列查询条件中，通常能够有效利用 B+ 树索引的有？（多选）',
      ['A. WHERE id = 1024', 'B. WHERE name LIKE "张%"', 'C. WHERE name LIKE "%张"', 'D. WHERE created_at > "2026-01-01"'],
      'A,B,D', '等值匹配、前缀匹配、范围查询都可用索引定位；以 % 开头的模糊匹配无法确定索引起点，只能全表扫描。', '索引优化', d2, 's2', null],
    // ---- 软件工程 ----
    ['single_choice', 'easy', '用例图主要用于描述？',
      ['A. 系统功能与外部参与者的关系', 'B. 对象之间消息的时序', 'C. 数据的物理存储结构', 'D. 程序的算法流程'],
      'A', '用例图从外部视角描述参与者与用例及其关系，不表达执行顺序；顺序由时序图表达。', '用例图', d3, 's3',
      '用例图从外部参与者视角描述系统功能。'],
    ['true_false', 'medium', '敏捷开发强调先完成详尽的设计文档，再开始编码。',
      null, '错误', '敏捷宣言强调"可工作的软件高于详尽的文档"，通过短迭代持续交付并根据反馈调整，而非文档先行。', '敏捷开发', d3, 's3',
      '敏捷开发强调"个体与交互高于流程与工具、可工作的软件高于详尽的文档"。'],
    ['fill_blank', 'easy', '单元测试针对最小可测单元，通常由 ______ 编写并在编码阶段完成。',
      null, '开发者', '单元测试由开发者在编码阶段完成；集成测试验证模块接口；系统测试与验收测试由测试人员或用户参与。', '单元测试', d3, 's3',
      '单元测试针对最小可测单元，通常由开发者编写并在编码阶段完成。'],
  ];
  const qids = [];
  for (let i = 0; i < raw.length; i++) {
    const [type, difficulty, content, options, answer, explanation, kp, docId, subj, src] = raw[i];
    const id = await DB.add('questions', {
      type, difficulty, content, options, answer, explanation,
      knowledge_point: kp, document_id: docId, subject_id: subj,
      source_excerpt: src || '', created_at: now - (20 - i) * 3600000,
    });
    qids.push(id);
  }

  /* 6. 练习记录（近 7 天，供统计页使用） */
  const seedPractice = [
    [0, 1], [1, 0], [2, 1], [3, 1], [4, 0], [5, 1], [6, 1], [7, 1], [8, 0], [9, 1],
    [10, 1], [11, 1], [12, 0], [13, 1], [14, 1], [15, 1], [16, 0], [17, 1], [18, 1], [19, 1],
    [0, 1], [2, 1], [3, 0], [6, 1], [7, 1], [10, 1], [14, 1], [18, 1],
    [1, 1], [4, 1], [5, 0], [8, 1], [12, 1], [15, 0], [16, 1],
    [0, 1], [2, 1], [7, 0], [10, 1], [13, 1], [17, 1],
  ];
  for (let d = 0; d < 7; d++) {
    const cnt = 4 + ((d * 3) % 5);
    for (let k = 0; k < cnt; k++) {
      const p = seedPractice[(d * 5 + k) % seedPractice.length];
      await DB.add('practice', {
        question_id: qids[p[0]], is_correct: p[1],
        answered_at: now - d * DAY - (k + 1) * 600000,
      });
    }
  }

  /* 7. 错题本 */
  const wrong = [
    [1, 'C', 'TIME_WAIT 状态持续 2MSL 的原因记忆混淆，误以为是加快释放。', '关闭连接时主动方需要等待 2MSL 才能确保最后 ACK 被对方收到。'],
    [12, 'WHERE', '聚合函数条件写在了 WHERE 里，执行顺序理解不牢。', 'WHERE 在分组前过滤行，HAVING 在分组后过滤分组。'],
    [16, 'A,C', '把"以 % 开头"的模糊匹配也算成了可用索引的情形。', '以 % 开头无法确定索引起点，只能全表扫描。'],
    [4, 'A,B', '漏选了 C（检测到碰撞应立即停止发送）。', 'CSMA/CD 是"冲突停发"，检测到碰撞立刻停止并随机退避。'],
  ];
  for (const [qi, ua, reason, note] of wrong) {
    const q = await DB.get('questions', qids[qi]);
    await DB.add('mistakes', {
      question_id: q.id, user_answer: ua, correct_answer: q.answer,
      mistake_reason: reason, note, created_at: now - 2 * DAY, question_content: q.content,
      type: q.type, difficulty: q.difficulty,
    });
  }

  /* 8. 间隔复习卡：4 张已学（3 张今日到期 / 1 张逾期），6 张新卡 */
  const reviewSeed = [
    { qi: 0, reps: 3, interval: 6, ease: 2.5, due: now - 2 * 3600000, lapses: 0 },
    { qi: 2, reps: 2, interval: 3, ease: 2.4, due: now - 5 * 3600000, lapses: 1 },
    { qi: 10, reps: 1, interval: 1, ease: 2.5, due: now - 26 * 3600000, lapses: 0 },
    { qi: 17, reps: 4, interval: 15, ease: 2.6, due: now - 600000, lapses: 1 },
    { qi: 3, reps: 0, interval: 0, ease: 2.5, due: now },
    { qi: 6, reps: 0, interval: 0, ease: 2.5, due: now },
    { qi: 8, reps: 0, interval: 0, ease: 2.5, due: now },
    { qi: 11, reps: 0, interval: 0, ease: 2.5, due: now },
    { qi: 13, reps: 0, interval: 0, ease: 2.5, due: now },
    { qi: 19, reps: 0, interval: 0, ease: 2.5, due: now },
  ];
  for (const r of reviewSeed) {
    await DB.add('review', {
      question_id: qids[r.qi], ease: r.ease, interval: r.interval, reps: r.reps,
      lapses: r.lapses, due: r.due, added_at: now - 8 * DAY,
      last_at: r.reps ? now - r.interval * DAY : null, hist: [],
    });
  }

  /* 9. 考试记录（两条，供成绩趋势） */
  const buildRec = async (name, offsetDay, picked, rightSet, obtained, total) => {
    const results = [];
    for (let i = 0; i < picked.length; i++) {
      const q = await DB.get('questions', qids[picked[i]]);
      const ok = rightSet.includes(i);
      const max = q.type === 'short_answer' ? 20 : 10;
      results.push({
        qid: q.id, type: q.type, difficulty: q.difficulty, content: q.content,
        options: q.options, answer: q.answer, explanation: q.explanation,
        knowledge_point: q.knowledge_point, user: ok ? q.answer : '（答案不完整）',
        correct: ok, note: ok ? '' : '要点缺失', score: ok ? max : Math.round(max * 0.3), max,
      });
    }
    await DB.add('exams', {
      name, started_at: now - offsetDay * DAY, submitted_at: now - offsetDay * DAY + 1560000,
      duration_sec: 1560,
      config: { subj: '', doc: '', kps: [], types: ['single_choice', 'multiple_choice', 'true_false', 'fill_blank', 'short_answer'], diffs: ['easy', 'medium', 'hard'], count: picked.length, minutes: 30, score: { single_choice: 10, multiple_choice: 10, true_false: 10, fill_blank: 10, short_answer: 20 } },
      results, obtained, total, auto_submit: 0,
    });
  };
  await buildRec('第 3 章 数据链路层 单元测验', 5, [0, 1, 2, 3, 4, 5, 6, 7], [0, 2, 3, 5, 6, 7], 55, 100);
  await buildRec('网络 + 数据库 综合模拟卷', 1, [0, 3, 10, 11, 12, 13, 14, 7], [0, 2, 3, 4, 5, 6, 7], 78, 100);

  /* 10. 知识库：知识点笔记 / 手记 / 查询收藏 / 搜索历史 */
  await DB.kvSet('kpNotes', {
    '三次握手': { text: '三次握手的目的不是"握手三次"本身，而是双方各自确认：①自己的发送能力正常；②对方的接收能力正常；③对方的初始序号已被确认。SYN 报文不携带数据但要消耗一个序号。', at: now - 3 * DAY },
    '索引优化': { text: '记忆口诀：函数、前置通配、类型转换、最左前缀——四类写法会让 B+ 树索引直接失效。', at: now - 2 * DAY },
  });
  await DB.bkvSet('kbNotes', [
    { id: 'n1', kp: '拥塞控制', text: '慢开始指"起始门槛低、增长速度快"，不是"增长慢"。cwnd 从 1 个 MSS 开始，每 RTT 翻倍，到 ssthresh 后转线性。', at: now - 4 * DAY, updatedAt: now - 4 * DAY },
    { id: 'n2', kp: '', text: '复习节奏安排：每天早上 8 点做当天到期卡（约 20 张），晚上睡前过一遍「忘记」的卡片，一周后再看 14 天预告调整每日上限。', at: now - 30 * 3600000, updatedAt: now - 30 * 3600000 },
  ]);
  await DB.bkvSet('kbSearchHist', [
    { q: 'TCP 三次握手 为什么不能是两次', at: now - 3600000, engine: 'bingcn', kp: '三次握手' },
    { q: 'B+ 树索引失效的常见场景', at: now - 2 * DAY, engine: 'aggregate', kp: '索引优化' },
  ]);
  await DB.bkvSet('wsFavs', [
    {
      id: 'f1', q: 'TCP 三次握手 为什么不能是两次', kp: '三次握手', engine: 'bingcn', kind: 'ai',
      title: 'AI 讲解 · 三次握手的必要性', url: '', snippet: '',
      ai: '两次握手无法让服务端确认客户端的接收能力。若客户端的一个旧 SYN 延迟到达，服务端回复 SYN+ACK 后即认为连接建立并分配资源，而客户端并不认这个连接，服务端会长期空等。第三次握手让服务端确认"客户端确实收到了我的 SYN+ACK"，从而避免历史连接占用资源。',
      at: now - 3600000,
    },
    {
      id: 'f2', q: 'B+ 树索引失效的常见场景', kp: '索引优化', engine: 'aggregate', kind: 'search',
      title: 'MySQL 索引失效的 8 种场景与排查方法', url: 'https://example.com/mysql-index-fail', snippet: '对索引列使用函数、隐式类型转换、以 % 开头的 LIKE、联合索引不满足最左前缀、OR 条件中存在非索引列……',
      ai: '', at: now - 2 * DAY,
    },
  ]);

  await refreshData();
  await loadSubjects();
  /* kvSet 的 settings 可能在 boot 时已加载、后续不重读，直接补写运行态，保证截图显示"已配置" */
  state.settings.apiKey = 'sk-demo-8f3a2c7e1b9d4f60';
  return 'seeded:' + qids.length + '题';
})()
