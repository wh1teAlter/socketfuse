/**
 * inline Worker 的最小启动入口。
 *
 * 生成器会把该模块及其依赖打成单一 IIFE；入口本身不引入页面 API，保证可在
 * SharedWorker realm 初始化。
 */
import { exposeSharedWebSocketWorker } from '@socketfuse/core'

exposeSharedWebSocketWorker()
