package handler

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"backend/internal/model"
	"backend/internal/store"
	"github.com/gin-gonic/gin"
)

// ==========================================
// 资产批量导入（CSV）— 与前端「导出 CSV」格式互通
// ==========================================

// 表头别名 → 规范字段名
var assetHeaderAlias = map[string]string{
	"名称": "name", "name": "name",
	"ip": "ip", "ip地址": "ip", "地址": "ip",
	"类型": "type", "type": "type",
	"状态": "status", "status": "status",
	"厂商": "vendor", "vendor": "vendor",
	"系统": "os", "操作系统": "os", "os": "os", "os_version": "os",
	"架构": "arch", "arch": "arch",
	"虚拟化": "virtualization", "virtualization": "virtualization",
	"端口": "ports", "ports": "ports",
	"标签": "tags", "tags": "tags",
	"描述": "description", "备注": "description", "description": "description",
}

func normalizeAssetType(s string) string {
	switch strings.TrimSpace(s) {
	case "server", "switch", "router", "other":
		return strings.TrimSpace(s)
	case "PC 服务器", "服务器", "PC服务器":
		return "server"
	case "以太网交换机", "交换机":
		return "switch"
	case "核心路由器", "路由器":
		return "router"
	default:
		return "other"
	}
}

func normalizeStatus(s string) string {
	switch strings.TrimSpace(s) {
	case "online", "在线":
		return "online"
	case "offline", "离线":
		return "offline"
	default:
		return "unknown"
	}
}

// normalizePorts 把 "[22, 80]" 或 "22,80" / "22 80" 统一为紧凑 JSON 数组字符串
func normalizePorts(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	var arr []int
	if json.Unmarshal([]byte(s), &arr) == nil {
		b, _ := json.Marshal(arr)
		return string(b)
	}
	fields := strings.FieldsFunc(s, func(r rune) bool { return r == ',' || r == ' ' || r == ';' })
	ports := make([]int, 0, len(fields))
	for _, f := range fields {
		if n, err := strconv.Atoi(strings.TrimSpace(f)); err == nil {
			ports = append(ports, n)
		}
	}
	if len(ports) == 0 {
		return ""
	}
	b, _ := json.Marshal(ports)
	return string(b)
}

// normalizeTags 把 '["生产","DMZ"]' 或 "生产,DMZ" 统一为 JSON 数组字符串
func normalizeTags(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	var arr []string
	if json.Unmarshal([]byte(s), &arr) == nil {
		b, _ := json.Marshal(arr)
		return string(b)
	}
	parts := strings.Split(s, ",")
	tags := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			tags = append(tags, t)
		}
	}
	if len(tags) == 0 {
		return ""
	}
	b, _ := json.Marshal(tags)
	return string(b)
}

// ImportAssets 解析上传的 CSV，按 IP 去重 upsert 资产
func ImportAssets(c *gin.Context) {
	db := store.GlobalDB

	fileHeader, err := c.FormFile("file")
	if err != nil {
		SendError(c, 400, "请上传 CSV 文件（表单字段名 file）")
		return
	}
	f, err := fileHeader.Open()
	if err != nil {
		SendError(c, 400, "无法读取上传文件")
		return
	}
	defer f.Close()

	reader := csv.NewReader(f)
	reader.FieldsPerRecord = -1 // 容忍列数不一致
	records, err := reader.ReadAll()
	if err != nil {
		SendError(c, 400, "CSV 解析失败: "+err.Error())
		return
	}
	if len(records) < 2 {
		SendError(c, 400, "CSV 为空或仅有表头")
		return
	}

	// 解析表头 → 列索引（去除首单元格可能存在的 BOM）
	header := records[0]
	colIdx := map[string]int{}
	for i, h := range header {
		h = strings.TrimSpace(h)
		// 去掉 Excel 导出常见的 UTF-8 BOM 前缀（EF BB BF）
		if len(h) >= 3 && h[0] == 0xEF && h[1] == 0xBB && h[2] == 0xBF {
			h = h[3:]
		}
		if field, ok := assetHeaderAlias[strings.ToLower(h)]; ok {
			colIdx[field] = i
		} else if field, ok := assetHeaderAlias[h]; ok {
			colIdx[field] = i
		}
	}
	if _, ok := colIdx["ip"]; !ok {
		SendError(c, 400, "CSV 缺少必需的「IP」列")
		return
	}

	get := func(row []string, field string) string {
		if idx, ok := colIdx[field]; ok && idx < len(row) {
			return strings.TrimSpace(row[idx])
		}
		return ""
	}
	has := func(field string) bool { _, ok := colIdx[field]; return ok }

	var created, updated, failed int
	errs := []string{}

	for i, row := range records[1:] {
		lineNo := i + 2 // 含表头的真实行号
		ip := get(row, "ip")
		if ip == "" {
			failed++
			errs = append(errs, fmt.Sprintf("第 %d 行：IP 为空，已跳过", lineNo))
			continue
		}
		// 仅写入 CSV 中实际存在的列，避免「子集列」覆盖已有数据
		fields := map[string]interface{}{}
		if has("name") {
			if n := get(row, "name"); n != "" {
				fields["name"] = n
			}
		}
		if has("type") {
			fields["type"] = normalizeAssetType(get(row, "type"))
		}
		if has("vendor") {
			fields["vendor"] = get(row, "vendor")
		}
		if has("os") {
			fields["os_version"] = get(row, "os")
		}
		if has("arch") {
			fields["arch"] = get(row, "arch")
		}
		if has("virtualization") {
			fields["virtualization"] = get(row, "virtualization")
		}
		if has("ports") {
			fields["ports"] = normalizePorts(get(row, "ports"))
		}
		if has("tags") {
			fields["tags"] = normalizeTags(get(row, "tags"))
		}
		if has("description") {
			fields["description"] = get(row, "description")
		}
		if has("status") {
			if s := get(row, "status"); s != "" {
				fields["status"] = normalizeStatus(s)
			}
		}

		var existing model.Asset
		if err := db.Where("ip = ?", ip).First(&existing).Error; err == nil {
			// 数据隔离：非管理员不能更新他人资产
			if !canAccess(c, existing.OwnerID) {
				failed++
				errs = append(errs, fmt.Sprintf("第 %d 行（%s）：该 IP 已属于他人资产，无权更新", lineNo, ip))
				continue
			}
			// 更新：仅写入 CSV 提供的列
			if len(fields) > 0 {
				if err := db.Model(&existing).Updates(fields).Error; err != nil {
					failed++
					errs = append(errs, fmt.Sprintf("第 %d 行（%s）：更新失败 %v", lineNo, ip, err))
					continue
				}
			}
			updated++
		} else {
			// 新建：名称缺省用 IP，类型缺省 other，归属导入者
			asset := model.Asset{IP: ip, Name: ip, Type: "other", Status: "unknown", OwnerID: currentUserID(c)}
			if v, ok := fields["name"].(string); ok && v != "" {
				asset.Name = v
			}
			if v, ok := fields["type"].(string); ok {
				asset.Type = v
			}
			if v, ok := fields["vendor"].(string); ok {
				asset.Vendor = v
			}
			if v, ok := fields["os_version"].(string); ok {
				asset.OSVersion = v
			}
			if v, ok := fields["arch"].(string); ok {
				asset.Arch = v
			}
			if v, ok := fields["virtualization"].(string); ok {
				asset.Virtualization = v
			}
			if v, ok := fields["ports"].(string); ok {
				asset.Ports = v
			}
			if v, ok := fields["tags"].(string); ok {
				asset.Tags = v
			}
			if v, ok := fields["description"].(string); ok {
				asset.Description = v
			}
			if v, ok := fields["status"].(string); ok {
				asset.Status = v
			}
			if err := db.Create(&asset).Error; err != nil {
				failed++
				errs = append(errs, fmt.Sprintf("第 %d 行（%s）：创建失败 %v", lineNo, ip, err))
				continue
			}
			created++
		}
	}

	logActivity(db, "asset_imported", fmt.Sprintf("CSV 导入资产：新增 %d，更新 %d，失败 %d", created, updated, failed), 0)
	SendSuccess(c, gin.H{"created": created, "updated": updated, "failed": failed, "errors": errs})
}
