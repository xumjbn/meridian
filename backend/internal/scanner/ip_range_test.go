package scanner

import (
	"reflect"
	"testing"
)

func TestParseIPRange(t *testing.T) {
	tests := []struct {
		name    string
		target  string
		want    []string
		wantErr bool
	}{
		{
			name:    "Single IP",
			target:  "192.168.1.5",
			want:    []string{"192.168.1.5"},
			wantErr: false,
		},
		{
			name:    "IP Range Full",
			target:  "192.168.1.1-192.168.1.3",
			want:    []string{"192.168.1.1", "192.168.1.2", "192.168.1.3"},
			wantErr: false,
		},
		{
			name:    "IP Range Short",
			target:  "192.168.1.250-252",
			want:    []string{"192.168.1.250", "192.168.1.251", "192.168.1.252"},
			wantErr: false,
		},
		{
			name:    "CIDR /30",
			target:  "192.168.1.4/30",
			want:    []string{"192.168.1.5", "192.168.1.6"}, // .4 is network, .7 is broadcast
			wantErr: false,
		},
		{
			name:    "Invalid Target",
			target:  "invalid-ip",
			want:    nil,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := (ParseIPRange(tt.target))
			if (err != nil) != tt.wantErr {
				t.Errorf("ParseIPRange() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && !reflect.DeepEqual(got, tt.want) {
				t.Errorf("ParseIPRange() got = %v, want %v", got, tt.want)
			}
		})
	}
}
