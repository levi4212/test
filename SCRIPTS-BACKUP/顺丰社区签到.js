/*
------------------------------------------
@Author: Sliverkiss
@Date: 2024.10.16
@Description:顺丰速运 体验社区
------------------------------------------
脚本兼容：Surge、QuantumultX、Loon、Shadowrocket、Node.js
只测试过QuantumultX，其它环境请自行尝试

@Description:
脚本兼容：Surge、QuantumultX、Loon、Shadowrocket，不支持青龙

重写：打开app，进入体验社区

[rewrite_local]
^https:\/\/ccsp-egmas\.sf-express\.com\/cx-app-member\/member\/app\/oauth2\/authorize url script-request-body https://gist.githubusercontent.com/Sliverkiss/2cadc6a4022ab2866aced9adda0a5744/raw/sfsyCommunity.js

[MITM]
hostname = ccsp-egmas.sf-express.com

⚠️【免责声明】
------------------------------------------
1、此脚本仅用于学习研究，不保证其合法性、准确性、有效性，请根据情况自行判断，本人对此不承担任何保证责任。
2、由于此脚本仅用于学习研究，您必须在下载后 24 小时内将所有内容从您的计算机或手机或任何存储设备中完全删除，若违反规定引起任何事件本人对此均不负责。
3、请勿将此脚本用于任何商业或非法目的，若违反规定请自行对此负责。
4、此脚本涉及应用与本人无关，本人对因此引起的任何隐私泄漏或其他后果不承担任何责任。
5、本人对任何脚本引发的问题概不负责，包括但不限于由脚本错误引起的任何损失和损害。
6、如果任何单位或个人认为此脚本可能涉嫌侵犯其权利，应及时通知并提供身份证明，所有权证明，我们将在收到认证文件确认后删除此脚本。
7、所有直接或间接使用、查看此脚本的人均应该仔细阅读此声明。本人保留随时更改或补充此声明的权利。一旦您使用或复制了此脚本，即视为您已接受此免责声明。
*/
const $ = new Env("顺丰速运-体验社区");
//notify
const notify = $.isNode() ? require('./sendNotify') : '';
const ckName = "sfsy_community_data";
const userCookie = $.toObj($.isNode() ? process.env[ckName] : $.getdata(ckName)) || [];
//用户多账号配置
$.userIdx = 0, $.userList = [], $.notifyMsg = [];
//成功个数
$.succCount = 0;
//debug
$.is_debug = ($.isNode() ? process.env.IS_DEDUG : $.getdata('is_debug')) || 'false';
$.is_paper = ($.isNode() ? process.env["sfsy_community_paper"] : $.getdata('sfsy_community_paper')) || 'false';
//------------------------------------------
async function main() {
    for (let user of $.userList) {
        //$.notifyMsg = [], $.title = "";
        try {
            let code = await user.getCode();
            await user.Login(code);
            if (user.ckStatus) {
                let { integralUsable: pointF, userName } = await user.getUserInfo();
                user.userName = userName;
                await user.signin();
                let taskList = await user.getTaskList();
                for (let item of taskList) {
                    switch (item?.name) {
                        case "发布话题":
                            break;
                        case "评论点赞":
                            await user.taskTopic();
                            break;
                        case "参与调研":
                            if ($.is_paper == "false") break;
                            for (let i = 1; i <= item?.count; i++) {
                                await user.taskPaper();
                                if (!user.paperStatus) break;
                                await $.wait(5e3);
                            }
                            break;
                        default:
                            break;
                    }
                }
                let { integralSum, integralUsable: pointE } = await user.getUserInfo();
                if (pointE >= 1000) {
                    await user.exchange();
                    pointE = pointE - 1000;
                }
                $.notifyMsg.push(`[${userName}] 可兑换体验值:${pointF}${pointE >= pointF ? "+" : ""}${pointE - 0 - pointF}`);
                $.succCount++;
            } else {
                DoubleLog(`用户: ${user?.userName} 积分: 查询失败，用户需要去登录`)
            }
        } catch (e) {
            throw e
        }
    }
    $.title = `共${$.userList.length}个账号,成功${$.succCount}个,失败${$.userList.length - 0 - $.succCount}个`
    //notify
    await sendMsg($.notifyMsg.join("\n"), { $media: $.avatar });
}

//用户
class UserInfo {
    constructor(user) {
        //默认属性
        this.index = ++$.userIdx;
        this.token = "" || user.token || user;
        this.userId = "" || user.userId;
        this.userName = user.userName || this.index;
        this.avatar = user.avatar;
        this.ckStatus = true;
        this.paperStatus = true;
        //请求封装
        this.baseUrl = `https://eooc-answer.sf-express.com`;
        this.headers = user.headers;
        this.getRandomTime = () => randomInt(1e3, 3e3);
        this.fetch = async (o) => {
            try {
                if (typeof o === 'string') o = { url: o };
                if ((!o?.url) || o?.url?.startsWith("/") || o?.url?.startsWith(":")) o.url = this.baseUrl + (o.url || '')
                const res = await Request({ ...o, headers: o.headers || this.headers, url: o.url || this.baseUrl })
                debug(res, o?.url?.replace(/\/+$/, '').substring(o?.url?.lastIndexOf('/') + 1));
                //if (res?.msg && res?.msg?.match(/请重新登录/)) throw new Error(res?.msg);
                return res;
            } catch (e) {
                this.ckStatus = false;
                $.error(`[${this.userName || this.index}]请求发起失败!${e}`);
            }
        }
    }
    //获取code
    async getCode() {
        try {
            const opts = {
                url: "https://ccsp-egmas.sf-express.com/cx-app-member/member/app/oauth2/authorize",
                type: "post",
                dataType: "json",
                body: {
                    "memberId": this.userId,
                    "scope": "sf_mobile,sf_base",
                    "appid": "202303151757584530",
                    "host": "eooc-answer.sf-express.com"
                }
            }
            let res = await this.fetch(opts);;
            if (!res?.obj?.code) throw new Error(res?.errorMessage)
            $.info(`[${this.userName}] 获取code成功！${res?.obj?.code}`);
            return res?.obj?.code;
        } catch (e) {
            this.ckStatus = false;
            $.error(`[${this.userName || this.userId}] 错误！${e}`);
        }
    }
    //登录
    async Login(code) {
        try {
            const opts = {
                url: "/icloud/put/app/auth",
                type: "get",
                resultType: "all",
                headers: {
                    'Referer': `https://eooc-answer.sf-express.com/community/transition`,
                    'Host': `eooc-answer.sf-express.com`,
                    'User-Agent': `Mozilla/5.0 (iPhone; CPU iPhone OS 15_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 mediaCode=SFEXPRESSAPP-iOS-ML`,
                },
                params: {
                    code: code,
                    cem_timestamp: Date.now()
                }
            }
            let res = await this.fetch(opts);
            let headers = ObjectKeys2LowerCase(res?.headers) ?? {};
            //对青龙进行兼容
            let session = Array.isArray(headers['set-cookie']) ? [...new Set(headers['set-cookie'])].join("") : headers['set-cookie'];
            res = session?.match(/(community)=.+?;/g) ?? [];
            this.session = res.join("")
            if (!this.session) throw new Error("获取session失败！")
            this.headers = {
                'Referer': 'https://eooc-answer.sf-express.com/community/user',
                'cem-community': decodeURIComponent(this.session.split("community=")[1]),
                'Cookie': this.session,
                'Content-Type': 'application/json',
            }
            $.info(`[${this.userName}] 登录成功！`);
        } catch (e) {
            this.ckStatus = false;
            $.error(`[${this.userName || this.userId}] 错误！${e}`);
        }
    }
    //签到
    async signin() {
        try {
            const opts = {
                url: "/icloud/put/sign_in/sign",
                type: "get",
                params: {
                    cem_timestamp: Date.now()
                }
            }
            let res = await this.fetch(opts);;
            $.info(`[${this.userName}] 签到:${res?.msg}`);
        } catch (e) {
            this.ckStatus = false;
            $.error(`[${this.userName || this.userId}] 错误！${e}`);
        }
    }
    //获取用户信息
    async getUserInfo() {
        try {
            const opts = {
                url: "/icloud/put/sf_user/detail",
                type: "get",
                params: {
                    cem_timestamp: Date.now()
                }
            }
            let res = await this.fetch(opts);;
            return res?.data;
            //$.info(`[${this.userName}] 签到:${res?.msg}`);
        } catch (e) {
            this.ckStatus = false;
            $.error(`[${this.userName || this.userId}] 错误！${e}`);
        }
    }
    //获取任务列表
    async getTaskList() {
        try {
            const opts = {
                url: "/icloud/put/sign_in/tasks",
                type: "get",
                params: {
                    cem_timestamp: Date.now()
                }
            }
            let res = await this.fetch(opts);;
            let taskList = res?.data.map(e => {
                return {
                    name: e?.name,
                    count: e?.name == "评论点赞" ? (e.aimNum - e.num) / 2 : e.aimNum - e.num
                }
            }).filter(e => e?.count != 0);
            return taskList;
        } catch (e) {
            this.ckStatus = false;
            $.error(`[${this.userName || this.userId}] 错误！${e}`);
        }
    }
    //提交调研
    async submit(surveyId, answerId) {
        try {
            const opts = {
                url: "/icloud/answer/core/submit",
                type: "post",
                dataType: "json",
                body: {
                    status: "1",
                    answerQuestionVOList: [],
                    "answerId": answerId,
                    "surveyId": surveyId
                }
            }
            let res = await this.fetch(opts);;
            $.info(`[${this.userName}] 提交问卷:${res?.msg}`);
        } catch (e) {
            this.ckStatus = false;
            this.paperStatus = false;
            $.error(`[${this.userName || this.userId}] 错误！${e}`);
        }
    }
    //获取调研列表
    async getSurveyList() {
        try {
            const opts = {
                url: "/icloud/put/sf_survey/list",
                type: "get",
                params: {
                    current: 1,
                    size: 10,
                    topicTitle: "",
                    subjectId: "SU20220829161013854148208705536",
                    cem_timestamp: Date.now()
                }
            }
            let res = await this.fetch(opts);
            return res?.data?.list?.filter(e => e.status != 2) ?? [];
        } catch (e) {
            this.ckStatus = false;
            $.error(`[${this.userName || this.userId}] 错误！${e}`);
        }
    }
    //获取调研问卷验证信息
    async getSurveAuth(randomCode) {
        try {
            const opts = {
                url: "/icloud/answer/core/auth",
                type: "get",
                params: {
                    randomCode: randomCode
                }
            }
            let res = await this.fetch(opts);;
            if (!res?.data?.data) throw new Error('每个ip限制回答一次');
            return res?.data?.data;
        } catch (e) {
            this.ckStatus = false;
            this.paperStatus = false;
            $.error(`[${this.userName || this.userId}] 错误！${e}`);
        }
    }
    //执行调研任务
    async taskPaper() {
        try {
            let list = await this.getSurveyList();
            if (list) {
                $.info(`[${this.userName}] 获取调用问卷:${list[0]?.surveyTitle}`)
                let [, code] = list[0]?.surveyUrl.split("https://eooc-answer.sf-express.com/a/q/");
                let res = await this.getSurveAuth(code);
                if (this.paperStatus) await this.submit(list[0].surveyId, res?.answerId);
            }
        } catch (e) {
            $.error(e);
        }
    }
    //获取调查问卷题目
    async getSurveyPaper(surveyId) {
        try {
            const opts = {
                url: "/icloud/answer/core/getSurvey",
                type: "get",
                params: {
                    surveyId: surveyId
                }
            }
            let res = await this.fetch(opts);;
            return res?.data;
        } catch (e) {
            this.ckStatus = false;
            $.error(`[${this.userName || this.userId}] 错误！${e}`);
        }
    }
    //执行评论点赞任务
    async taskTopic() {
        try {
            let topicList = await this.getTopicList();
            for (let item of topicList) {
                $.info(`[${this.userName}] 获取帖子:${item?.title}`);
                //评论
                await this.comment(item?.topicId);
                await $.wait(1e3);
                //点赞
                await this.praise(item?.topicId, 1);
                await $.wait(1e3);
                //取消点赞
                await this.praise(item?.topicId, 0);
                await $.wait(1e3);
            }
        } catch (e) {
            $.error(e);
        }
    }
    //获取帖子列表
    async getTopicList() {
        try {
            const opts = {
                url: "/icloud/put/topic/topicList",
                type: "get",
                params: {
                    current: 1,
                    size: 1000,
                    topicTitle: "",
                    subjectId: "SU20220825161012396212072554496",
                    cem_timestamp: Date.now()
                }
            }
            let res = await this.fetch(opts);
            //返回数组中的随机3个
            return res?.data?.list?.length >= 3
                ? res.data.list.sort(() => Math.random() - 0.5).slice(0, 3)
                : [];
        } catch (e) {
            this.ckStatus = false;
            $.error(`[${this.userName || this.userId}] 错误！${e}`);
        }
    }
    //点赞
    async praise(topicId, type) {
        let msg = type == 1 ? "点赞" : "取消点赞";
        try {
            const opts = {
                url: "/icloud/put/topic/praise",
                type: "post",
                dataType: "json",
                params: {
                    cem_timestamp: Date.now()
                },
                body: {
                    topicId: topicId,
                    isPraise: type
                }
            }
            let res = await this.fetch(opts);;
            $.info(`[${this.userName}] ${msg}:${res?.msg}`);
        } catch (e) {
            this.ckStatus = false;
            $.error(`[${this.userName || this.userId}] 错误！${e}`);
        }
    }
    //评论
    async comment(topicId) {
        try {
            const opts = {
                url: "/icloud/put/topic/commentSubmit",
                type: "post",
                dataType: "json",
                params: {
                    cem_timestamp: Date.now()
                },
                body: {
                    topicId: topicId,
                    content: '每天坚持签到',
                    commentId: '',
                    intranetImg: ''

                }
            }
            let res = await this.fetch(opts);;
            $.info(`[${this.userName}] 评论:${res?.msg}`);
        } catch (e) {
            this.ckStatus = false;
            $.error(`[${this.userName || this.userId}] 错误！${e}`);
        }
    }
    //兑换积分
    async exchange() {
        try {
            const opts = {
                url: "/icloud/put/integral/exchange",
                type: "post",
                dataType: "json",
                params: {
                    cem_timestamp: Date.now()
                },
                body: {
                    integral: 1000
                }
            }
            let res = await this.fetch(opts);;
            $.info(`[${this.userName}] 兑换积分:${res?.msg}`);
        } catch (e) {
            this.ckStatus = false;
            $.error(`[${this.userName || this.userId}] 错误！${e}`);
        }
    }
    //


}

//远程通知
async function getNotice() {
    const urls = [
        "https://fastly.jsdelivr.net/gh/Sliverkiss/GoodNight@main/notice.json",
        "https://fastly.jsdelivr.net/gh/Sliverkiss/GoodNight@main/tip.json"
    ];

    try {
        const responses = await Promise.all(urls.map(url => Request(url)));
        responses.map(result => $.log(result?.notice || "获取通知失败"));
        if (responses[0]?.notice) return true;
    } catch (error) {
        console.log(`❌获取通知时发生错误：${error}`);
    }
}


// 获取Cookie
async function getCookie() {
    try {
        if ($request && $request.method === 'OPTIONS') return;

        const Body = $.toObj($request.body);
        if (!Body?.memberId) throw new Error("获取token失败！参数缺失");

        const newData = {
            "userId": Body?.memberId,
            "headers": $request.headers,
            "userName": Body?.data?.nickname
        }
        const index = userCookie.findIndex(e => e.userId == newData.userId);
        userCookie[index] ? userCookie[index] = newData : userCookie.push(newData);

        $.setjson(userCookie, ckName);
        let userName = index != -1 ? index : userCookie.length - 1;
        $.msg($.name, `🎉账号[${userName + 1}]更新token成功!`, ``);
    } catch (e) {
        throw e;
    }
}

//处理node
function getEnvByNode() {
    let ckList = $.toObj(process.env[ckName]);
    if (!ckList) {
        ckList = ckList.split("&");
        ckList = ckList.map(e => {
            const [token, userName] = e.split('#');
            let newData = {
                "userId": userName,
                "token": token,
                "userName": userName
            }
            return newData
        });
    }
    return ckList;
}

//主程序执行入口
!(async () => {
    try {
        if (typeof $request != "undefined") {
            await getCookie();
        } else {
            if (!(await getNotice())) throw new Error("网络状况不好，请重新尝试~")
            await checkEnv();
            await main();
        }
    } catch (e) {
        throw e;
    }
})()
    .catch((e) => { $.logErr(e), $.msg($.name, `⛔️ script run error!`, e.message || e) })
    .finally(async () => {
        $.done({});
    });

/** ---------------------------------固定不动区域----------------------------------------- */
//prettier-ignore

async function sendMsg(a, e) { a && ($.isNode() ? await notify.sendNotify($.name, a) : $.msg($.name, $.title || "", a, e)) }
function DoubleLog(o) { o && ($.log(`${o}`), $.notifyMsg.push(`${o}`)) };
async function checkEnv() { try { if (!userCookie?.length) throw new Error("no available accounts found"); $.log(`\n[INFO] 检测到 ${userCookie?.length ?? 0} 个账号\n`), $.userList.push(...userCookie.map((o => new UserInfo(o))).filter(Boolean)) } catch (o) { throw o } }
function debug(g, e = "debug") { "true" === $.is_debug && ($.log(`\n-----------${e}------------\n`), $.log("string" == typeof g ? g : $.toStr(g) || `debug error => t=${g}`), $.log(`\n-----------${e}------------\n`)) }
//From xream's ObjectKeys2LowerCase
function ObjectKeys2LowerCase(obj) { return !obj ? {} : Object.fromEntries(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v])) };
//From sliverkiss's Request
async function Request(t) { "string" == typeof t && (t = { url: t }); try { if (!t?.url) throw new Error("[URL][ERROR] 缺少 url 参数"); let { url: o, type: e, headers: r = {}, body: s, params: a, dataType: n = "form", resultType: u = "data" } = t; const p = e ? e?.toLowerCase() : "body" in t ? "post" : "get", c = o.concat("post" === p ? "?" + $.queryStr(a) : ""), i = t.timeout ? $.isSurge() ? t.timeout / 1e3 : t.timeout : 1e4; "json" === n && (r["Content-Type"] = "application/json;charset=UTF-8"); const y = "string" == typeof s ? s : (s && "form" == n ? $.queryStr(s) : $.toStr(s)), l = { ...t, ...t?.opts ? t.opts : {}, url: c, headers: r, ..."post" === p && { body: y }, ..."get" === p && a && { params: a }, timeout: i }, m = $.http[p.toLowerCase()](l).then((t => "data" == u ? $.toObj(t.body) || t.body : $.toObj(t) || t)).catch((t => $.log(`[${p.toUpperCase()}][ERROR] ${t}\n`))); return Promise.race([new Promise(((t, o) => setTimeout((() => o("当前请求已超时")), i))), m]) } catch (t) { console.log(`[${p.toUpperCase()}][ERROR] ${t}\n`) } }
//From chavyleung's Env.js
function Env(t, e) { class s { constructor(t) { this.env = t } send(t, e = "GET") { t = "string" == typeof t ? { url: t } : t; let s = this.get; return "POST" === e && (s = this.post), new Promise(((e, i) => { s.call(this, t, ((t, s, o) => { t ? i(t) : e(s) })) })) } get(t) { return this.send.call(this.env, t) } post(t) { return this.send.call(this.env, t, "POST") } } return new class { constructor(t, e) { this.logLevels = { debug: 0, info: 1, warn: 2, error: 3 }, this.logLevelPrefixs = { debug: "[DEBUG] ", info: "[INFO] ", warn: "[WARN] ", error: "[ERROR] " }, this.logLevel = "info", this.name = t, this.http = new s(this), this.data = null, this.dataFile = "box.dat", this.logs = [], this.isMute = !1, this.isNeedRewrite = !1, this.logSeparator = "\n", this.encoding = "utf-8", this.startTime = (new Date).getTime(), Object.assign(this, e), this.log("", `🔔${this.name}, 开始!`) } getEnv() { return "undefined" != typeof $environment && $environment["surge-version"] ? "Surge" : "undefined" != typeof $environment && $environment["stash-version"] ? "Stash" : "undefined" != typeof module && module.exports ? "Node.js" : "undefined" != typeof $task ? "Quantumult X" : "undefined" != typeof $loon ? "Loon" : "undefined" != typeof $rocket ? "Shadowrocket" : void 0 } isNode() { return "Node.js" === this.getEnv() } isQuanX() { return "Quantumult X" === this.getEnv() } isSurge() { return "Surge" === this.getEnv() } isLoon() { return "Loon" === this.getEnv() } isShadowrocket() { return "Shadowrocket" === this.getEnv() } isStash() { return "Stash" === this.getEnv() } toObj(t, e = null) { try { return JSON.parse(t) } catch { return e } } toStr(t, e = null, ...s) { try { return JSON.stringify(t, ...s) } catch { return e } } getjson(t, e) { let s = e; if (this.getdata(t)) try { s = JSON.parse(this.getdata(t)) } catch { } return s } setjson(t, e) { try { return this.setdata(JSON.stringify(t), e) } catch { return !1 } } getScript(t) { return new Promise((e => { this.get({ url: t }, ((t, s, i) => e(i))) })) } runScript(t, e) { return new Promise((s => { let i = this.getdata("@chavy_boxjs_userCfgs.httpapi"); i = i ? i.replace(/\n/g, "").trim() : i; let o = this.getdata("@chavy_boxjs_userCfgs.httpapi_timeout"); o = o ? 1 * o : 20, o = e && e.timeout ? e.timeout : o; const [r, a] = i.split("@"), n = { url: `http://${a}/v1/scripting/evaluate`, body: { script_text: t, mock_type: "cron", timeout: o }, headers: { "X-Key": r, Accept: "*/*" }, timeout: o }; this.post(n, ((t, e, i) => s(i))) })).catch((t => this.logErr(t))) } loaddata() { if (!this.isNode()) return {}; { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), i = !s && this.fs.existsSync(e); if (!s && !i) return {}; { const i = s ? t : e; try { return JSON.parse(this.fs.readFileSync(i)) } catch (t) { return {} } } } } writedata() { if (this.isNode()) { this.fs = this.fs ? this.fs : require("fs"), this.path = this.path ? this.path : require("path"); const t = this.path.resolve(this.dataFile), e = this.path.resolve(process.cwd(), this.dataFile), s = this.fs.existsSync(t), i = !s && this.fs.existsSync(e), o = JSON.stringify(this.data); s ? this.fs.writeFileSync(t, o) : i ? this.fs.writeFileSync(e, o) : this.fs.writeFileSync(t, o) } } lodash_get(t, e, s) { const i = e.replace(/\[(\d+)\]/g, ".$1").split("."); let o = t; for (const t of i) if (o = Object(o)[t], void 0 === o) return s; return o } lodash_set(t, e, s) { return Object(t) !== t || (Array.isArray(e) || (e = e.toString().match(/[^.[\]]+/g) || []), e.slice(0, -1).reduce(((t, s, i) => Object(t[s]) === t[s] ? t[s] : t[s] = Math.abs(e[i + 1]) >> 0 == +e[i + 1] ? [] : {}), t)[e[e.length - 1]] = s), t } getdata(t) { let e = this.getval(t); if (/^@/.test(t)) { const [, s, i] = /^@(.*?)\.(.*?)$/.exec(t), o = s ? this.getval(s) : ""; if (o) try { const t = JSON.parse(o); e = t ? this.lodash_get(t, i, "") : e } catch (t) { e = "" } } return e } setdata(t, e) { let s = !1; if (/^@/.test(e)) { const [, i, o] = /^@(.*?)\.(.*?)$/.exec(e), r = this.getval(i), a = i ? "null" === r ? null : r || "{}" : "{}"; try { const e = JSON.parse(a); this.lodash_set(e, o, t), s = this.setval(JSON.stringify(e), i) } catch (e) { const r = {}; this.lodash_set(r, o, t), s = this.setval(JSON.stringify(r), i) } } else s = this.setval(t, e); return s } getval(t) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.read(t); case "Quantumult X": return $prefs.valueForKey(t); case "Node.js": return this.data = this.loaddata(), this.data[t]; default: return this.data && this.data[t] || null } } setval(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": return $persistentStore.write(t, e); case "Quantumult X": return $prefs.setValueForKey(t, e); case "Node.js": return this.data = this.loaddata(), this.data[e] = t, this.writedata(), !0; default: return this.data && this.data[e] || null } } initGotEnv(t) { this.got = this.got ? this.got : require("got"), this.cktough = this.cktough ? this.cktough : require("tough-cookie"), this.ckjar = this.ckjar ? this.ckjar : new this.cktough.CookieJar, t && (t.headers = t.headers ? t.headers : {}, t && (t.headers = t.headers ? t.headers : {}, void 0 === t.headers.cookie && void 0 === t.headers.Cookie && void 0 === t.cookieJar && (t.cookieJar = this.ckjar))) } get(t, e = (() => { })) { switch (t.headers && (delete t.headers["Content-Type"], delete t.headers["Content-Length"], delete t.headers["content-type"], delete t.headers["content-length"]), t.params && (t.url += "?" + this.queryStr(t.params)), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient.get(t, ((t, s, i) => { !t && s && (s.body = i, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, i) })); break; case "Quantumult X": this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: i, headers: o, body: r, bodyBytes: a } = t; e(null, { status: s, statusCode: i, headers: o, body: r, bodyBytes: a }, r, a) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let s = require("iconv-lite"); this.initGotEnv(t), this.got(t).on("redirect", ((t, e) => { try { if (t.headers["set-cookie"]) { const s = t.headers["set-cookie"].map(this.cktough.Cookie.parse).toString(); s && this.ckjar.setCookieSync(s, null), e.cookieJar = this.ckjar } } catch (t) { this.logErr(t) } })).then((t => { const { statusCode: i, statusCode: o, headers: r, rawBody: a } = t, n = s.decode(a, this.encoding); e(null, { status: i, statusCode: o, headers: r, rawBody: a, body: n }, n) }), (t => { const { message: i, response: o } = t; e(i, o, o && s.decode(o.rawBody, this.encoding)) })); break } } post(t, e = (() => { })) { const s = t.method ? t.method.toLocaleLowerCase() : "post"; switch (t.body && t.headers && !t.headers["Content-Type"] && !t.headers["content-type"] && (t.headers["content-type"] = "application/x-www-form-urlencoded"), t.headers && (delete t.headers["Content-Length"], delete t.headers["content-length"]), void 0 === t.followRedirect || t.followRedirect || ((this.isSurge() || this.isLoon()) && (t["auto-redirect"] = !1), this.isQuanX() && (t.opts ? t.opts.redirection = !1 : t.opts = { redirection: !1 })), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: this.isSurge() && this.isNeedRewrite && (t.headers = t.headers || {}, Object.assign(t.headers, { "X-Surge-Skip-Scripting": !1 })), $httpClient[s](t, ((t, s, i) => { !t && s && (s.body = i, s.statusCode = s.status ? s.status : s.statusCode, s.status = s.statusCode), e(t, s, i) })); break; case "Quantumult X": t.method = s, this.isNeedRewrite && (t.opts = t.opts || {}, Object.assign(t.opts, { hints: !1 })), $task.fetch(t).then((t => { const { statusCode: s, statusCode: i, headers: o, body: r, bodyBytes: a } = t; e(null, { status: s, statusCode: i, headers: o, body: r, bodyBytes: a }, r, a) }), (t => e(t && t.error || "UndefinedError"))); break; case "Node.js": let i = require("iconv-lite"); this.initGotEnv(t); const { url: o, ...r } = t; this.got[s](o, r).then((t => { const { statusCode: s, statusCode: o, headers: r, rawBody: a } = t, n = i.decode(a, this.encoding); e(null, { status: s, statusCode: o, headers: r, rawBody: a, body: n }, n) }), (t => { const { message: s, response: o } = t; e(s, o, o && i.decode(o.rawBody, this.encoding)) })); break } } time(t, e = null) { const s = e ? new Date(e) : new Date; let i = { "M+": s.getMonth() + 1, "d+": s.getDate(), "H+": s.getHours(), "m+": s.getMinutes(), "s+": s.getSeconds(), "q+": Math.floor((s.getMonth() + 3) / 3), S: s.getMilliseconds() }; /(y+)/.test(t) && (t = t.replace(RegExp.$1, (s.getFullYear() + "").substr(4 - RegExp.$1.length))); for (let e in i) new RegExp("(" + e + ")").test(t) && (t = t.replace(RegExp.$1, 1 == RegExp.$1.length ? i[e] : ("00" + i[e]).substr(("" + i[e]).length))); return t } queryStr(t) { let e = ""; for (const s in t) { let i = t[s]; null != i && "" !== i && ("object" == typeof i && (i = JSON.stringify(i)), e += `${s}=${i}&`) } return e = e.substring(0, e.length - 1), e } msg(e = t, s = "", i = "", o = {}) { const r = t => { const { $open: e, $copy: s, $media: i, $mediaMime: o } = t; switch (typeof t) { case void 0: return t; case "string": switch (this.getEnv()) { case "Surge": case "Stash": default: return { url: t }; case "Loon": case "Shadowrocket": return t; case "Quantumult X": return { "open-url": t }; case "Node.js": return }case "object": switch (this.getEnv()) { case "Surge": case "Stash": case "Shadowrocket": default: { const r = {}; let a = t.openUrl || t.url || t["open-url"] || e; a && Object.assign(r, { action: "open-url", url: a }); let n = t["update-pasteboard"] || t.updatePasteboard || s; if (n && Object.assign(r, { action: "clipboard", text: n }), i) { let t, e, s; if (i.startsWith("http")) t = i; else if (i.startsWith("data:")) { const [t] = i.split(";"), [, o] = i.split(","); e = o, s = t.replace("data:", "") } else { e = i, s = (t => { const e = { JVBERi0: "application/pdf", R0lGODdh: "image/gif", R0lGODlh: "image/gif", iVBORw0KGgo: "image/png", "/9j/": "image/jpg" }; for (var s in e) if (0 === t.indexOf(s)) return e[s]; return null })(i) } Object.assign(r, { "media-url": t, "media-base64": e, "media-base64-mime": o ?? s }) } return Object.assign(r, { "auto-dismiss": t["auto-dismiss"], sound: t.sound }), r } case "Loon": { const s = {}; let o = t.openUrl || t.url || t["open-url"] || e; o && Object.assign(s, { openUrl: o }); let r = t.mediaUrl || t["media-url"]; return i?.startsWith("http") && (r = i), r && Object.assign(s, { mediaUrl: r }), console.log(JSON.stringify(s)), s } case "Quantumult X": { const o = {}; let r = t["open-url"] || t.url || t.openUrl || e; r && Object.assign(o, { "open-url": r }); let a = t["media-url"] || t.mediaUrl; i?.startsWith("http") && (a = i), a && Object.assign(o, { "media-url": a }); let n = t["update-pasteboard"] || t.updatePasteboard || s; return n && Object.assign(o, { "update-pasteboard": n }), console.log(JSON.stringify(o)), o } case "Node.js": return }default: return } }; if (!this.isMute) switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": default: $notification.post(e, s, i, r(o)); break; case "Quantumult X": $notify(e, s, i, r(o)); break; case "Node.js": break }if (!this.isMuteLog) { let t = ["", "==============📣系统通知📣=============="]; t.push(e), s && t.push(s), i && t.push(i), console.log(t.join("\n")), this.logs = this.logs.concat(t) } } debug(...t) { this.logLevels[this.logLevel] <= this.logLevels.debug && (t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(`${this.logLevelPrefixs.debug}${t.map((t => t ?? String(t))).join(this.logSeparator)}`)) } info(...t) { this.logLevels[this.logLevel] <= this.logLevels.info && (t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(`${this.logLevelPrefixs.info}${t.map((t => t ?? String(t))).join(this.logSeparator)}`)) } warn(...t) { this.logLevels[this.logLevel] <= this.logLevels.warn && (t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(`${this.logLevelPrefixs.warn}${t.map((t => t ?? String(t))).join(this.logSeparator)}`)) } error(...t) { this.logLevels[this.logLevel] <= this.logLevels.error && (t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(`${this.logLevelPrefixs.error}${t.map((t => t ?? String(t))).join(this.logSeparator)}`)) } log(...t) { t.length > 0 && (this.logs = [...this.logs, ...t]), console.log(t.map((t => t ?? String(t))).join(this.logSeparator)) } logErr(t, e) { switch (this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: this.log("", `❗️${this.name}, 错误!`, e, t); break; case "Node.js": this.log("", `❗️${this.name}, 错误!`, e, void 0 !== t.message ? t.message : t, t.stack); break } } wait(t) { return new Promise((e => setTimeout(e, t))) } done(t = {}) { const e = ((new Date).getTime() - this.startTime) / 1e3; switch (this.log("", `🔔${this.name}, 结束! 🕛 ${e} 秒`), this.log(), this.getEnv()) { case "Surge": case "Loon": case "Stash": case "Shadowrocket": case "Quantumult X": default: $done(t); break; case "Node.js": process.exit(1) } } }(t, e) }