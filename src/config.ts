export const config = {
  port: parseInt(process.env.PORT ?? "5335", 10),
  historySize: Math.max(1, parseInt(process.env.HISTORY_SIZE ?? "20", 10)),
};
