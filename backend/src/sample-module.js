({
  id: "sample-tools",
  version: "1.0.0",
  mount: function mount(ctx) {
    var title = document.createElement("h3");
    title.textContent = "示例云模块已启用";

    var tips = document.createElement("p");
    tips.textContent = "该模块由服务端授权并远程下发（CI gate 远端负例验证）。";

    var button = document.createElement("button");
    button.textContent = "在 AI 里创建测试文本";
    button.onclick = function () {
      ctx.callHost("createDemoTextOnArtboard", { text: "Cloud module says hello" })
        .then(function (result) {
          alert("Host 返回: " + result);
        });
    };

    ctx.container.appendChild(title);
    ctx.container.appendChild(tips);
    ctx.container.appendChild(button);
  }
})
