/*
------------------------------------------
@Author: Sliverkiss
@Date: 2024.07.08
@Description:酷乐潮玩 日常任务
------------------------------------------
脚本兼容：Surge、QuantumultX、Loon、Shadowrocket、Node.js
只测试过QuantumultX，其它环境请自行尝试

2024.5.12 更新内容：增加自动获取活动id，修复抽奖失败的问题
2024.12.05 更新内容：增加幸运抽奖任务,多个活动id用,分割

重写:打开软件，点击我的，获取token后及时关闭，避免不必要的冲突

[rewrite_local]
^https:\/\/klwg\.klcw\.net\.cn\/r url script-response-body https://gist.githubusercontent.com/Sliverkiss/efa386f4ea8b25bfed3cd0db5bdb9d6f/raw/klwg.js

[MITM]
hostname = klwg.klcw.net.cn

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
const $ = new Env("酷乐潮玩");
//notify
const notify = $.isNode() ? require('./sendNotify') : '';
const ckName = "klwg_data";
const userCookie = $.toObj($.isNode() ? process.env[ckName] : $.getdata(ckName)) || [];
//用户多账号配置
$.userIdx = 0, $.userList = [], $.notifyMsg = [];
//成功个数
$.succCount = 0;
//debug
$.is_debug = ($.isNode() ? process.env.IS_DEDUG : $.getdata('is_debug')) || 'false';
$.shopId = ($.isNode() ? process.env["klwg_shopId"] : $.getdata('klwg_shopId')) || "200327001";//门店模版id
//------------------------------------------
async function main() {
    for (let user of $.userList) {
        //$.notifyMsg = [], $.title = "";
        try {
            //taskList = taskList.filter(e => !e?.task_name?.match(/个人信息|发布|购物|玩\+卡会员|积分兑换/))
            let pointF = await user.GetPoint();
            await user.signIn();
            if (user.ckStatus) {
                //获取任务列表
                let taskList = await user.getTaskList() ?? [];
                //过滤已经完成的任务
                taskList = taskList.filter(e => !e?.status);
                //taskList = taskList.filter(e => !e?.task_name?.match(/个人信息|发布|购物|玩\+卡会员|积分兑换/))               
                for (let task of taskList) {
                    await user.finishTask(task);
                    await $.wait(5e3);
                }
                //领取所有奖励
                let rewards = await user.getRewardList() ?? [];
                if (rewards) await user.receiveReward(rewards);
                //抽奖
                let advertisementList = await user.getAdvertisementList() ?? [];
                for (let item of advertisementList) {
                    if (await user.getActivityDetail(item, $.shopId)) {
                        let activityList = await user.getActivityIds(item, $.shopId);
                        for (let activityId of activityList) {
                            let activityTaskList = await user.drawDetail(activityId);
                            if (!activityTaskList) continue;
                            activityTaskList = activityTaskList.filter(e => e.status == 0);
                            let activityRewards = [];
                            for (let item of activityTaskList) {
                                let rewardId = await user.finishActivity(item);
                                rewardId && activityRewards.push(rewardId);
                            }
                            if (activityRewards?.length > 0) await user.receiveActivity(activityRewards);
                            await user.draw(activityId);
                        }
                    }
                }

                let pointE = await user.GetPoint();
                let userInfo = await user.GetUserInfo();
                let str = pointE >= pointF ? '+' : '-';
                $.notifyMsg.push(`用户:${userInfo?.nick_name} 积分:${pointF}${str}${pointE - 0 - pointF}`);
                $.succCount++;
            } else {
                DoubleLog(`⛔️ 「${user.userName ?? `账号${index}`}」签到失败, 用户需要去登录`)
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
        this.deviceId = user?.deviceId
        this.drawCount = 0;
        this.drawStatus = true
        this.userName = user.userName;
        this.avatar = user.avatar;
        this.ckStatus = true;
        //请求封装
        this.baseUrl = `https://klwg.klcw.net.cn/r`;
        this.headers = {
            'Connection': `keep-alive`,
            'Accept-Encoding': `gzip, deflate, br`,
            'chnflg': `ios`,
            'X-Version-Number': `3.24.0`,
            'Content-Type': `application/x-www-form-urlencoded`,
            'User-Agent': `KLMemberMobileApp/3.24.0 (iPhone; iOS 15.4.1; Scale/3.00)`,
            'X-Device-Number': this.deviceId,
            'X-Member-Token': this.token,
            'Accept-Language': `zh-Hans-CN;q=1, en-CN;q=0.9`,
            'Accept': `*/*`
        }
        this.fetch = async (o) => {
            try {
                if (typeof o === 'string') o = { url: o };
                o.dataType = "form";
                o.type = "post";
                if ((!o?.url) || o?.url?.startsWith("/") || o?.url?.startsWith(":")) o.url = this.baseUrl + (o.url || '')
                const res = await Request({ ...o, headers: o.headers || this.headers, url: o.url })
                debug(res, o?.url?.replace(/\/+$/, '').substring(o?.url?.lastIndexOf('/') + 1));
                //if (res?.Code == "-3001") throw new Error(res?.Message || `用户需要去登录`);
                return res;
            } catch (e) {
                this.ckStatus = false;
                $.log(`[${this.userName || this.index}][ERROR] 请求发起失败!${e}\n`);
            }
        }
    }
    //对body数据进行脱敏处理
    getBody(obj) {
        const { method, params: data } = obj
        const timestamp = getTimestamp();
        const app_key = "8000";
        const params = obj?.more ? base64Encode(data) : base64Encode({
            "use_platform": "2",
            "channel_num_id": "99",
            "data_sign": "0",
            "tenant_num_id": "8",
            "channel_app": "1",
            "app_version": "3.24.0",
            "access_token": this.token,
            "user_num_id": this.userId,
            "user_code": this.userId,
            ...data
        });
        let sign = getSign(params, app_key, timestamp, method);
        return $.queryStr({ app_key, method, params: encodeURIComponent(params), sign, timestamp });
    }
    //查询积分
    async GetPoint() {
        try {
            const opts = {
                body: this.getBody({
                    method: "gb.member.new.integralat.point",
                    params: {}
                })
            }
            let res = await this.fetch(opts);
            if (res?.code != 0) throw new Error(res?.message);
            $.info(`[${this.userName || this.index}] 用户积分:${res?.point}`);
            return res?.point;
            //this.token = res?.data?.token;
        } catch (e) {
            this.ckStatus = false;
            $.error(`[${this.userName || this.index}] 用户积分:${e}`)
        }
    }
    //查询用户信息
    async GetUserInfo() {
        try {
            const opts = {
                body: this.getBody({
                    method: "gb.member.new.basic.info.get",
                    params: { "integral_sign": "1" }
                })
            }
            let res = await this.fetch(opts);
            if (res?.code != 0) throw new Error(res?.message);
            //$.info(`[${this.userName || this.index}] 用户积分:${res?.point}`);
            return res;
            //this.token = res?.data?.token;
        } catch (e) {
            this.ckStatus = false;
            $.error(`[${this.userName || this.index}] 用户积分:${e}`)
        }
    }
    //签到
    async signIn() {
        try {
            const opts = {
                body: this.getBody({
                    method: "com.xdl.cn.appservice.AppTaskService.signIn",
                    params: {}
                })
            }
            let res = await this.fetch(opts);
            //if (res?.code != 0) throw new Error(res?.message);
            $.info(`[${this.userName || this.index}] 今日签到:${res?.message}`);
        } catch (e) {
            this.ckStatus = false;
            $.error(`[${this.userName || this.index}] 今日签到:${e}`)
        }
    }
    //获取任务列表
    async getTaskList() {
        try {
            const opts = {
                body: this.getBody({
                    method: "com.xdl.cn.appservice.AppTaskService.listUserTasks",
                    params: { "page_num": 1, "page_size": 100 }
                })
            }
            let res = await this.fetch(opts);
            return res?.data?.list;
            //if (res?.code != 0) throw new Error(res?.message);
            //$.info(`[${this.userName || this.index}] 签到:${res?.message}`);
        } catch (e) {
            this.ckStatus = false;
            $.error(`[${this.userName || this.index}] 获取任务列表:${e}`)
        }
    }
    //完成任务
    async finishTask(task) {
        try {
            const opts = {
                body: this.getBody({
                    method: "xdl.app.appTask.finishTask",
                    params: { "task_id": task?.id, "task_type": task?.type }
                })
            }
            let res = await this.fetch(opts);
            $.info(`[${this.userName || this.index}] ${task?.task_name}:${res?.message}`);
            //if (res?.code != 0) throw new Error(res?.message);
        } catch (e) {
            this.ckStatus = false;
            $.error(`[${this.userName || this.index}] 获取任务列表:${e}`)
        }
    }
    //获取待领取奖励列表
    async getRewardList() {
        try {
            const opts = {
                body: this.getBody({
                    method: "xdl.app.appTask.rewardList",
                    params: {}
                })
            }
            let res = await this.fetch(opts);
            return res?.data;
        } catch (e) {
            this.ckStatus = false;
            $.error(`[${this.userName || this.index}] 获取任务列表:${e}`)
        }
    }
    //领取奖励
    async receiveReward(rewards) {
        try {
            const opts = {
                body: this.getBody({
                    method: "xdl.app.appTask.receiveReward",
                    params: { "rewards": rewards }
                })
            }
            let res = await this.fetch(opts);
            //if (res?.code != 0) throw new Error(res?.message);
            $.info(`[${this.userName || this.index}] 领取所有奖励:${res?.message}`);
        } catch (e) {
            this.ckStatus = false;
            $.error(`[${this.userName || this.index}] 获取任务列表:${e}`)
        }
    }
    //获取所有活动id
    async getAdvertisementList() {
        try {
            const opts = {
                more: true,//开启自定义params
                body: this.getBody({
                    method: "com.xdl.cn.appservice.AppAdvertisementService.listAdvertisement",
                    params: { "use_platform": "2", "channel_num_id": "99", "tenant_num_id": "8", "data_sign": "0", "advertisement_user_code": "800037" }
                })
            }
            let res = await this.fetch(opts);
            let advertisementList = res?.data?.[0]?.detail_list?.map(e => e?.advertisement_detail_url).filter(e => !e?.match(/http/))
            return advertisementList;
            //if (res?.code != 0) throw new Error(res?.message);
            //$.info(`[${this.userName || this.index}] 领取所有奖励:${res?.message}`);
        } catch (e) {
            this.ckStatus = false;
            $.error(`[${this.userName || this.index}] 获取所有活动id列表:${e}`)
        }
    }
    //获取活动信息
    async getActivityDetail(tmplId, shopId) {
        try {
            const opts = {
                body: this.getBody({
                    method: "com.ykcloud.soa.omp.basicdata.api.service.BdShopTmplInstanceService.getTmplInstanceDetailsV2",
                    params: {
                        "tmpl_num_id": tmplId,
                        "flash": "-1",
                        "ec_shop_num_id": shopId
                    }
                })
            }
            let res = await this.fetch(opts);
            if (!res?.instance) throw new Error(res?.message);
            let title = res?.instance?.tmpl_title;
            return !title?.match(/积分派兑|添加福利|抽选活动/);
        } catch (e) {
            this.ckStatus = false;
            $.error(`[${this.userName || this.index}] 获取活动列表:${e}`)
        }
    }
    //获取所有活动信息
    async getActivityIds(tmplId, shopId) {
        try {
            const opts = {
                body: this.getBody({
                    method: "com.ykcloud.soa.omp.basicdata.api.service.BdShopTmplInstanceService.getTmplInstanceDetailsV2",
                    params: {
                        "tmpl_num_id": tmplId,
                        "flash": "-1",
                        "ec_shop_num_id": shopId
                    }
                })
            }
            let res = await this.fetch(opts);
            if (!res?.instance) throw new Error(res?.message);
            let activityList = [];
            for (let activityItem of res?.instance?.data) {
                let data = activityItem?.widgets_data_params;
                data = $.toObj(data);
                for (let item of data?.pictures) {
                    //$.info($.toStr(item));
                    if (item?.hot_area) {
                        let activityIds = item?.hot_area?.map(e => {
                            let { code } = getQueries(e?.linktarget);
                            return code;
                        })
                        if (activityIds?.length >= 1) activityList.push(...activityIds);
                    }
                }
            }
            activityList = activityList.filter(e => e != null);
            return activityList;
        } catch (e) {
            this.ckStatus = false;
            $.error(`[${this.userName || this.index}] 获取活动列表:${e}`)
        }
    }
    //抽奖活动详情
    async drawDetail(activityId) {
        try {
            const opts = {
                body: this.getBody({
                    method: "xdl.app.raffle.task.detail",
                    params: { "raffle_activity_code": activityId }
                })
            }
            let res = await this.fetch(opts);
            if (res?.raffle_activity?.activity_name?.match(/积分场/)) throw new Error(`跳过积分场次[${res?.raffle_activity?.activity_name}]`);

            $.info(`[${this.userName}] ${res?.raffle_activity?.activity_name}:${res?.raffle_activity?.status_name}`);
            return res?.task_list;
        } catch (e) {
            $.error(`[${this.userName || this.index}] 活动详情:${e}`)
        }
    }

    async draw(activityId) {
        try {
            const opts = {
                body: this.getBody({
                    method: "xdl.app.raffle.task.draw",
                    params: { "raffle_activity_code": activityId }
                })
            }
            let res = await this.fetch(opts);
            if (res?.code != 0) throw new Error(res?.message);
            $.info(`[${this.userName}] 抽奖:${res?.data?.prize_name || res?.message}`);
            //this.token = res?.data?.token;
        } catch (e) {
            $.error(`[${this.userName || this.index}] 活动抽奖:${e}`)
        }
    }
    //完成活动任务
    async finishActivity(task) {
        try {
            const opts = {
                body: this.getBody({
                    method: "xdl.app.raffle.task.finish",
                    params: { "task_id": task?.id }
                })
            }
            let res = await this.fetch(opts);
            if (res?.code != 0) throw new Error(res?.message);
            $.info(`[${this.userName}] 完成[${task?.task_name}]任务:${res?.message}`);
            //this.token = res?.data?.token;
            return res?.data?.id;
        } catch (e) {
            $.error(`[${this.userName || this.index}] 完成[${task?.task_name}]任务:${e}`)
        }
    }
    async receiveActivity(taskList) {
        try {
            const opts = {
                body: this.getBody({
                    method: "xdl.app.raffle.task.receive",
                    params: { "reward_ids": taskList }
                })
            }
            let res = await this.fetch(opts);
            if (res?.code != 0) throw new Error(res?.message);
            $.info(`[${this.userName}] 领取活动奖励:${res?.message}`);
            //this.token = res?.data?.token;
        } catch (e) {
            $.error(`[${this.userName || this.index}] 领取活动奖励:${e}`)
        }
    }
}


function getTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0'); // 月份从0开始，所以要加1，并且保证两位
    const day = String(now.getDate()).padStart(2, '0'); // 日
    const hours = String(now.getHours()).padStart(2, '0'); // 小时
    const minutes = String(now.getMinutes()).padStart(2, '0'); // 分钟
    const seconds = String(now.getSeconds()).padStart(2, '0'); // 秒

    return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

function base64Encode(obj) {
    // 将对象序列化为 JSON 字符串
    const jsonString = JSON.stringify(obj);
    // 对 JSON 字符串进行 Base64 编码
    return $.CryptoJS.enc.Base64.stringify($.CryptoJS.enc.Utf8.parse(jsonString));
}

function base64Decode(encodedStr) {
    // 解码 Base64 字符串为字节数组
    const decodedBytes = $.CryptoJS.enc.Base64.parse(encodedStr);
    // 将字节数组转换为 UTF-8 字符串
    const decodedStr = $.CryptoJS.enc.Utf8.stringify(decodedBytes);
    // 将 UTF-8 字符串解析为对象
    return JSON.parse(decodedStr);
}

//获取sign加密
function getSign(params, app_key, timestamp, method) {
    const data = `${params}${app_key}${timestamp}${method}`;
    return $.CryptoJS.MD5(data).toString($.CryptoJS.enc.Hex);
}

// 获取Cookie
async function getCookie() {
    try {
        if ($request && $request.method === 'OPTIONS') return;
        let Body = $.toObj($response.body);
        if (!Body["usr_num_id"]) return;
        const headers = ObjectKeys2LowerCase($request.headers) ?? {};

        if (!(headers['x-member-token'])) throw new Error("获取token失败！参数缺失");

        const newData = {
            "userId": Body["usr_num_id"],
            "token": headers['x-member-token'],
            "deviceId": headers['x-device-number'],
            "userName": Body["usr_name"] || "匿名用户"
        }
        const index = userCookie.findIndex(e => e.userId == newData.userId);
        userCookie[index] ? userCookie[index] = newData : userCookie.push(newData);

        $.setjson(userCookie, ckName);
        $.msg($.name, `🎉账号[${newData.userName}]更新token成功!`, ``);
    } catch (e) {
        throw e;
    }
}

//分割参数
function getQueries(t) {
    const [, e] = t.split("?");
    return e ? e.split("&").reduce((t, e) => {
        var [r, e] = e.split("=");
        return t[r] = e, t
    }, {}) : {}
};

//加载CryptoJS模块
async function loadCryptoJS() {
    let code = ($.isNode() ? require('crypto-js') : $.getdata('CryptoJS_code')) || '';
    //node环境
    if ($.isNode()) return code;
    //ios环境
    if (code && Object.keys(code).length) {
        console.log(`✅ ${$.name}: 缓存中存在CryptoJS代码, 跳过下载`)
        eval(code)
        return createCryptoJS();
    }
    console.log(`🚀 ${$.name}: 开始下载CryptoJS代码`)
    return new Promise(async (resolve) => {
        $.getScript(
            'https://cdn.jsdelivr.net/gh/Sliverkiss/QuantumultX@main/Utils/CryptoJS.min.js'
        ).then((fn) => {
            $.setdata(fn, 'CryptoJS_code')
            eval(fn)
            const CryptoJS = createCryptoJS();
            console.log(`✅ CryptoJS加载成功, 请继续`)
            resolve(CryptoJS)
        })
    })
}

//主程序执行入口
!(async () => {
    try {
        if (typeof $request != "undefined") {
            await getCookie();
        } else {
            $.CryptoJS = await loadCryptoJS();
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