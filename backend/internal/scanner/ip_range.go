package scanner

import (
	"encoding/binary"
	"fmt"
	"net"
	"strings"
)

// ParseIPRange 将不同格式的 IP 范围解析为 IP 列表
// 支持的格式:
// 1. 单个 IP: 192.168.1.1
// 2. CIDR: 192.168.1.0/24
// 3. IP 范围: 192.168.1.1-192.168.1.50
func ParseIPRange(target string) ([]string, error) {
	target = strings.TrimSpace(target)
	if target == "" {
		return nil, fmt.Errorf("empty target range")
	}

	// 1. 判断是否是 IP 范围格式 (A.B.C.D-E.F.G.H)
	if strings.Contains(target, "-") {
		parts := strings.Split(target, "-")
		if len(parts) != 2 {
			return nil, fmt.Errorf("invalid IP range format: %s", target)
		}
		startIPStr := strings.TrimSpace(parts[0])
		endIPStr := strings.TrimSpace(parts[1])

		startIP := net.ParseIP(startIPStr)
		if startIP == nil {
			return nil, fmt.Errorf("invalid start IP: %s", startIPStr)
		}
		
		// 可能是简写如 192.168.1.1-50
		var endIP net.IP
		if !strings.Contains(endIPStr, ".") {
			// 补全前缀
			lastDot := strings.LastIndex(startIPStr, ".")
			if lastDot == -1 {
				return nil, fmt.Errorf("invalid IP range: %s", target)
			}
			endIPStr = startIPStr[:lastDot+1] + endIPStr
		}
		
		endIP = net.ParseIP(endIPStr)
		if endIP == nil {
			return nil, fmt.Errorf("invalid end IP: %s", endIPStr)
		}

		return expandIPRange(startIP, endIP)
	}

	// 2. 判断是否是 CIDR 格式
	if strings.Contains(target, "/") {
		ip, ipNet, err := net.ParseCIDR(target)
		if err != nil {
			return nil, err
		}
		return expandCIDR(ip, ipNet)
	}

	// 3. 判断是否是单个 IP
	ip := net.ParseIP(target)
	if ip == nil {
		return nil, fmt.Errorf("invalid IP format: %s", target)
	}
	return []string{ip.String()}, nil
}

func ipToUint32(ip net.IP) uint32 {
	if len(ip) == 16 {
		return binary.BigEndian.Uint32(ip[12:16])
	}
	return binary.BigEndian.Uint32(ip)
}

func uint32ToIP(val uint32) net.IP {
	ip := make(net.IP, 4)
	binary.BigEndian.PutUint32(ip, val)
	return ip
}

func expandIPRange(start, end net.IP) ([]string, error) {
	startVal := ipToUint32(start)
	endVal := ipToUint32(end)

	if startVal > endVal {
		return nil, fmt.Errorf("start IP is greater than end IP")
	}

	// 限制单个扫描任务的最大 IP 数量，防止死循环或超大范围扫描
	if endVal-startVal > 2000 {
		return nil, fmt.Errorf("range size too large (max 2000 IPs)")
	}

	var ips []string
	for i := startVal; i <= endVal; i++ {
		ips = append(ips, uint32ToIP(i).String())
	}
	return ips, nil
}

func expandCIDR(ip net.IP, ipNet *net.IPNet) ([]string, error) {
	// 限制 CIDR 主机数上限（最多 /16 ≈ 65536），与区间写法保持一致的安全约束，
	// 防止 /8 之类超大网段一次性展开成千万级字符串切片撑爆内存。
	ones, bits := ipNet.Mask.Size()
	if bits-ones > 16 {
		return nil, fmt.Errorf("CIDR range too large (max /16, 65536 IPs)")
	}

	var ips []string
	for ip := ip.Mask(ipNet.Mask); ipNet.Contains(ip); inc(ip) {
		ips = append(ips, ip.String())
	}

	// 对于包含网络号和广播地址的 CIDR 网段 (大于 /31)，去掉首尾
	if ones < 31 && len(ips) > 2 {
		return ips[1 : len(ips)-1], nil
	}
	return ips, nil
}

func inc(ip net.IP) {
	for j := len(ip) - 1; j >= 0; j-- {
		ip[j]++
		if ip[j] > 0 {
			break
		}
	}
}
