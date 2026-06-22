package main

import (
	"log"
	"os"

	"backend/internal/handler"
	"backend/internal/monitor"
	"backend/internal/scheduler"
	"backend/internal/store"
	"github.com/gin-gonic/gin"
)

func CORSMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")
		if origin != "" {
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
		} else {
			c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		}
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE, HEAD")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}

func main() {
	// 1. 初始化数据库
	db := store.InitDB()
	sqlDB, err := db.DB()
	if err == nil {
		defer sqlDB.Close()
	}

	// 启动定时扫描调度器
	scheduler.Start(db)

	// 启动资产可用性监控（是否探测由 monitor_enabled 设置控制）
	monitor.Start(db)

	// 2. 初始化 Gin 引擎
	r := gin.Default()

	// 3. 应用跨域中间件
	r.Use(CORSMiddleware())

	// 4. 路由定义
	api := r.Group("/api")
	{
		// 审计中间件挂在最外层，覆盖含登录/注册在内的所有写操作
		api.Use(handler.AuditMiddleware())

		// ── 公开路由（无需登录）──────────────────
		api.POST("/login", handler.Login)
		api.POST("/register", handler.Register)

		// ── 以下全部需要登录（会话 token 校验）──────
		api.Use(handler.AuthMiddleware())

		api.POST("/logout", handler.Logout)
		// 本人修改密码（任意已登录用户）
		api.POST("/users/change-password", handler.ChangePassword)
		// 用户管理（仅管理员）
		api.GET("/users", handler.AdminMiddleware(), handler.ListUsers)
		api.POST("/users", handler.AdminMiddleware(), handler.CreateUser)
		api.PUT("/users/:id", handler.AdminMiddleware(), handler.UpdateUser)
		api.DELETE("/users/:id", handler.AdminMiddleware(), handler.DeleteUser)
		// 审计日志查询（仅管理员）
		api.GET("/audit", handler.AdminMiddleware(), handler.GetAuditLogs)

		// 仪表盘
		api.GET("/dashboard/stats", handler.GetDashboardStats)

		// 凭证管理
		api.GET("/credentials", handler.ListCredentials)
		api.POST("/credentials", handler.CreateCredential)
		api.PUT("/credentials/:id", handler.UpdateCredential)
		api.DELETE("/credentials/:id", handler.DeleteCredential)
		api.POST("/credentials/:id/test", handler.TestCredential)

		// 系统配置
		api.GET("/settings", handler.GetSettings)
		api.PUT("/settings", handler.UpdateSettings)

		// 告警通知测试
		api.POST("/notify/test", handler.TestNotify)

		// 资产管理
		api.GET("/assets", handler.ListAssets)
		api.POST("/assets/import", handler.ImportAssets) // CSV 批量导入（须在 :id 之前的静态路由）
		api.GET("/assets/:id", handler.GetAsset)
		api.POST("/assets", handler.CreateAsset)
		api.PUT("/assets/:id", handler.UpdateAsset)
		api.DELETE("/assets/:id", handler.DeleteAsset)

		// 自动发现扫描任务
		api.GET("/tasks", handler.ListScanTasks)
		api.POST("/tasks", handler.CreateScanTask)
		api.PUT("/tasks/:id", handler.UpdateScanTask)
		api.DELETE("/tasks/:id", handler.DeleteScanTask)
		api.POST("/tasks/:id/run", handler.RunScanTask)
		api.POST("/tasks/:id/stop", handler.StopScanTask)
		api.GET("/tasks/:id/logs", handler.GetScanLogs)
		api.GET("/tasks/:id/stream", handler.StreamScanLog)

		// 资产在线探测
		api.POST("/assets/:id/ping", handler.PingAsset)
		api.POST("/assets/batch-ping", handler.BatchPingAssets)

		// 资产可用性历史与在线率
		api.GET("/assets/:id/uptime", handler.GetAssetUptime)

		// 全局标签管理
		api.GET("/tags", handler.ListTags)
		api.POST("/tags", handler.CreateTag)
		api.PUT("/tags/:id", handler.UpdateTag)
		api.DELETE("/tags/:id", handler.DeleteTag)



		// 认证采集（架构/系统信息）
		api.POST("/assets/:id/collect", handler.CollectAsset)

		// 资产变更历史
		api.GET("/assets/:id/history", handler.GetAssetHistory)

		// 漏洞发现列表
		api.GET("/vulns", handler.GetVulnFindings)

		// 最近活动日志
		api.GET("/activity/recent", handler.GetRecentActivity)

		// WebSocket 终端连接
		api.GET("/ws/terminal/:id", handler.ConnectTerminal)
	}

	// 5. 启动服务：默认仅监听本机 127.0.0.1:8080；容器部署时由 LISTEN_ADDR
	//    设为 0.0.0.0:8080 以便 nginx 反向代理接入
	addr := os.Getenv("LISTEN_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8080"
	}
	log.Println("Meridian · 子午 — 网络资产发现与统一接入平台")
	log.Printf("Meridian backend is running on http://%s", addr)
	if err := r.Run(addr); err != nil {
		log.Fatalf("Failed to run server: %v", err)
	}
}
