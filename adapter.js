const qlEnvsStr = process.env.QL_ENVS;

if (qlEnvsStr) {
  try {
    const qlEnvs = JSON.parse(qlEnvsStr);

    for (const key in qlEnvs) {
      if (qlEnvs.hasOwnProperty(key)) {
        const dataInfo = qlEnvs[key];
        if (dataInfo && dataInfo.value) {
          try {
            const actualData = JSON.parse(dataInfo.value);
            // 将解析后的实际数据设置为环境变量
            process.env[key] = JSON.stringify(actualData);
            console.log(`[Adapter] 设置环境变量: ${key}`);
          } catch (error) {
            console.error(`[Adapter] 解析 ${key} 的 value 失败:`, error);
          }
        }
      }
    }

    console.log("[Adapter] 环境变量设置完成。");

  } catch (error) {
    console.error("[Adapter] 解析 QL_ENVS 失败:", error);
  }
} else {
  console.log("[Adapter] 未找到 QL_ENVS 环境变量。");
}
