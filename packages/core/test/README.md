# 契约测试夹具

通过真实 MessageChannel 接入统一 runtime，并用可控 native socket 观察 wire、连接数和关闭完成。夹具不绕开控制 parser 或页面公开行为；测试所有者必须 dispose 以结束端口和 timer。它只供 core 测试，不由公开包导出。
