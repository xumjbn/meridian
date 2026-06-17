package main

import (
	"log"

	"backend/internal/handler"
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

	// 2. 初始化 Gin 引擎
	r := gin.Default()

	// 3. 应用跨域中间件
	r.Use(CORSMiddleware())

	// 4. 路由定义
	api := r.Group("/api")
	{
		// 仪表盘
		api.GET("/dashboard/stats", handler.GetDashboardStats)

		// 凭证管理
		api.GET("/credentials", handler.ListCredentials)
		api.POST("/credentials", handler.CreateCredential)
		api.PUT("/credentials/:id", handler.UpdateCredential)
		api.DELETE("/credentials/:id", handler.DeleteCredential)

		// 资产管理
		api.GET("/assets", handler.ListAssets)
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

		// 资产在线探测
		api.POST("/assets/:id/ping", handler.PingAsset)

		// 最近活动日志
		api.GET("/activity/recent", handler.GetRecentActivity)

		// WebSocket 终端连接
		api.GET("/ws/terminal/:id", handler.ConnectTerminal)
	}

	// 5. 启动服务，监听 8080 端口
	log.Println("Backend server is running on http://localhost:8080")
	if err := r.Run("127.0.0.1:8080"); err != nil {
		log.Fatalf("Failed to run server: %v", err)
	}
}
