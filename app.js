//函式庫元件設定
var WebSocketServer = require('ws').Server;
var http = require("http");
var express = require("express");
var app = express();
var port = process.env.PORT || 5000;
var server = http.createServer(app);
server.listen(port);
var wss = new WebSocketServer({server: server})


var lookup = {};
var channels = {};
var gamevar = {};
var timeout = 1000;
var limit = 4;

//socket server監聽
wss.on('connection', function (ws) {


    lookup[ws.upgradeReq.headers["sec-websocket-key"]] = {
        key: "",
        act: "",
        memberId: 0,
        totalMembers: 0
    };

    var is_channel = false;
    ws.on('message', function (data) {

        var data = JSON.parse(data);
        switch (data.act) {

            case "joinChannel":
                //頻道長度要為八碼 & 頻道格式檢查
                if (data.key.length == 8 && /[A-Za-z0-9]{8}/.test(data.key)) {

                    if (!is_channel) {

                        if (typeof(channels[data.key]) == "undefined") {
                            ids = 1;
                            channels[data.key] = {};

                            //只有開頻道的人有資格取得遊戲變數
                            if (typeof(gamevar[data.key]) == "undefined") {
                                //之後要用外部 API 下載資訊，現在先用預設
                                gamevar[data.key] = {
                                    base_score: 25,  //從 API 要來的每月最短秒數
                                    ch_top_score: 999, //目前頻道中所有玩家中最短者的秒數
                                    ch_top_id: 0, //目前頻道中最短秒數玩家的 id
                                };
                            }
                        }

                        //id 只會累加，不會補到斷線 id 的空洞中，因為遊戲有任一個人斷線就重來
                        if (ids < limit + 1) {
                            //頻道人數在指定範圍內才配發 id ，不然就是 0
                            channels[data.key][ws.upgradeReq.headers["sec-websocket-key"]] = {
                                id: ids, //id
                                my_score: 999  //目前秒數
                            };
                            //才更新動作
                            lookup[ws.upgradeReq.headers["sec-websocket-key"]] = data;
                        }
                        ids++;
                    }

                    //2. 確定 id 回傳給申請人
                    data.act = "joinChannelSuccess";
                    if (!is_channel) data.memberId = channels[data.key][ws.upgradeReq.headers["sec-websocket-key"]].id;
                    if (!is_channel) if (ids > limit + 1) data.memberId = 0; //鎖定頻道最多只能 n 人
                    ws.send(JSON.stringify(data));


                    if (!is_channel) is_channel = true;
                    //3. 將 id 與頻道人數資訊廣撥給頻道內所有人
                    //注意當人數已滿時就不會再廣播，就算有人斷線產生空洞後再補新的人也不會有反應
                    if (ids <= limit + 1) {
                        data.totalMembers = (typeof(channels[data.key]) == "undefined") ? 0 : Object.keys(channels[data.key]).length; //頻道總人數
                        data.act = "getChannelStatus";
                        wss.clients.forEach(function (c) {
                            //廣播給特定自己頻道的人
                            //節縮頻寬、增加 CPU 、增加 MEM
                            if (lookup[c.upgradeReq.headers["sec-websocket-key"]].key == data.key) {
                                c.send(JSON.stringify(data));
                            }
                        });
                    }
                }
                //4. break
                break;


            case "lockChannel":
                if (channels[data.key]) {
                    data.act = "lockChannelSuccess";
                    wss.clients.forEach(function (c) {
                        if (lookup[c.upgradeReq.headers["sec-websocket-key"]].key == data.key) {
                            c.send(JSON.stringify(data));
                        }
                    });
                }
                break;

            case "saveDeviceData":
                wss.clients.forEach(function (c) {
                    if (
                        lookup[c.upgradeReq.headers["sec-websocket-key"]].key == data.key
                        && lookup[c.upgradeReq.headers["sec-websocket-key"]].memberId == 1
                    ) {
                        c.send(JSON.stringify(data));
                    }
                });
                break;


            /* 給頻道的Leader */
            case "memberToLeader":
                wss.clients.forEach(function (c) {
                    if (
                        lookup[c.upgradeReq.headers["sec-websocket-key"]].key == data.key
                        && lookup[c.upgradeReq.headers["sec-websocket-key"]].memberId == 1
                    ) {
                        c.send(JSON.stringify(data));
                    }
                });
                break;


            /* 廣播給頻道內全部的成員 */
            case "updateGame":
                wss.clients.forEach(function (c) {
                    if (lookup[c.upgradeReq.headers["sec-websocket-key"]].key == data.key) {
                        c.send(JSON.stringify(data));
                    }
                });
                break;


            case "keepConnectting":
                //console.log("keepConnectting");
                break;


            //一般常駐事件
            case "enter":
            case "buffer_web":
            case "buffer_mob":
            case "loadok_web":
            case "loadok_mob":
            case "mob":
                //0. 驗證身分
                if (
                    lookup[ws.upgradeReq.headers["sec-websocket-key"]].key == data.key //server 與 client 所存的頻道相同時
                    && lookup[ws.upgradeReq.headers["sec-websocket-key"]].memberId == data.id  //server 與 client 所存的 id 相同時
                    && (data.memberId >= 1 && data.memberId <= limit)                                 //id 在容許範圍內
                ) {
                    //1. 當有被核可動作產生時就需要更新表格
                    lookup[ws.upgradeReq.headers["sec-websocket-key"]] = data;

                    //2. 廣播
                    wss.clients.forEach(function (c) {
                        if (lookup[c.upgradeReq.headers["sec-websocket-key"]].key == data.key) {
                            c.send(JSON.stringify(data));
                        }
                    });
                }
                break;
        }

    });


    //監聽斷線事件
    ws.on('close', function () {
        //頻道id對應表 中 刪除此人(如果有頻道的話)
        if (typeof(channels[lookup[ws.upgradeReq.headers["sec-websocket-key"]].key]) != "undefined") {
            delete channels[lookup[ws.upgradeReq.headers["sec-websocket-key"]].key][ws.upgradeReq.headers["sec-websocket-key"]];
            //如果刪除後頻道中沒有人了，就連頻道也刪除(包含以頻道為 key 的兩張表)
            if (Object.keys(channels[lookup[ws.upgradeReq.headers["sec-websocket-key"]].key]).length == 0) {
                delete channels[lookup[ws.upgradeReq.headers["sec-websocket-key"]].key];
                delete gamevar[lookup[ws.upgradeReq.headers["sec-websocket-key"]].key];
            }
        }
        //廣播
        wss.clients.forEach(function (c) {
            //廣播給特定自己頻道的人
            //節縮頻寬、增加 CPU 、增加 MEM
            if (lookup[c.upgradeReq.headers["sec-websocket-key"]].key == lookup[ws.upgradeReq.headers["sec-websocket-key"]].key) {
                //廣播斷線
                lookup[ws.upgradeReq.headers["sec-websocket-key"]].act = "dead";
                c.send(JSON.stringify(lookup[ws.upgradeReq.headers["sec-websocket-key"]]));
                //廣播頻道目前人數
                lookup[ws.upgradeReq.headers["sec-websocket-key"]].tt = (typeof(channels[lookup[ws.upgradeReq.headers["sec-websocket-key"]].key]) == "undefined") ? 0 : Object.keys(channels[lookup[ws.upgradeReq.headers["sec-websocket-key"]].key]).length; //頻道總人數
                lookup[ws.upgradeReq.headers["sec-websocket-key"]].act = "nowtotal";
                c.send(JSON.stringify(lookup[ws.upgradeReq.headers["sec-websocket-key"]]));
                //console.log(c.upgradeReq.headers["sec-websocket-key"]);
            }
        });
        //ws頻道對應表 中 刪除此 ws
        delete lookup[ws.upgradeReq.headers["sec-websocket-key"]]; //就算不存在也可以清除不會有錯誤
        //console.log("========================================");
    });



});
