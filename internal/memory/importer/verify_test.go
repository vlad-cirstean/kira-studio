package importer

import "testing"

func TestQuestionable(t *testing.T) {
	const chunk = "The billing API listens on port 8443. Set `retry_limit` to 3. Use the PaymentGateway class from internal/billing/api.go, not the \"legacy path\"."
	for _, tc := range []struct {
		name string
		fact Fact
		want bool
	}{
		{"plain words only", Fact{Fact: "Billing API listens on its port."}, false},
		{"number present", Fact{Fact: "Billing API listens on 8443."}, false},
		{"number absent", Fact{Fact: "Billing API listens on 9090."}, true},
		{"number inside a longer source word", Fact{Fact: "Retries stop at 3."}, false},
		{"punctuation around token", Fact{Fact: "Port is (8443)."}, false},
		{"identifier absent", Fact{Fact: "Set `max_retries` to 3."}, true},
		{"underscore word present", Fact{Fact: "retry_limit caps retries."}, false},
		{"camelCase absent", Fact{Fact: "Use PaymentGatewayV2 only."}, true},
		{"PascalCase present, other case", Fact{Fact: "Use paymentgateway."}, false},
		{"path present", Fact{Fact: "Class lives in internal/billing/api.go."}, false},
		{"path absent", Fact{Fact: "Class lives in internal/billing/db.go."}, true},
		{"quoted span present", Fact{Fact: `Avoid the "legacy path".`}, false},
		{"quoted span absent", Fact{Fact: `Avoid the "old path".`}, true},
		{"unresolved wins", Fact{Fact: "It uses the API.", Unresolved: "which service"}, true},
		{"whitespace and case", Fact{Fact: "Port  8443\n is used."}, false},
	} {
		if got := Questionable(chunk, tc.fact); got != tc.want {
			t.Errorf("%s: Questionable = %v, want %v", tc.name, got, tc.want)
		}
	}
}
