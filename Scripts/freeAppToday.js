/*
美区 Apple Store 限免提醒 - Loon 版
作者: ChatGPT
功能:
1. 每日获取美区限免 App
2. Loon 通知推送
3. 点击通知直达 App Store
*/

const url = "https://api.gofans.cn/v1/m/app_records?page=1&limit=10";

const headers = {
  "User-Agent": "Mozilla/5.0",
  "Accept": "application/json"
};

$httpClient.get(
  {
    url,
    headers
  },
  function (error, response, data) {

    if (error) {
      console.log("请求失败：" + error);
      $notification.post(
        "美区限免",
        "获取失败",
        String(error)
      );
      $done();
      return;
    }

    try {

      const result = JSON.parse(data);

      if (!result || !result.data || result.data.length === 0) {
        $notification.post(
          "美区限免",
          "暂无限免",
          "今天没有发现限免应用"
        );
        $done();
        return;
      }

      const app = result.data[0];

      const title = app.name || "未知应用";
      const desc = app.description || "暂无介绍";
      const appId = app.trackId;

      const openUrl = `https://apps.apple.com/us/app/id${appId}`;

      $notification.post(
        `🆓 美区限免: ${title}`,
        "点击可直接跳转下载",
        desc,
        {
          openUrl: openUrl
        }
      );

      console.log(`推送成功: ${title}`);

    } catch (e) {

      console.log("解析失败：" + e);

      $notification.post(
        "美区限免",
        "数据解析失败",
        String(e)
      );
    }

    $done();
  }
);