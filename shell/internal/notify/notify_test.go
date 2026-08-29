package notify_test

import (
	"sync"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/shell/internal/notify"
)

func TestBothSubscribersReceiveEveryEmission(t *testing.T) {
	var e notify.Emitter[int]
	var got1, got2 []int
	unsub1 := e.Subscribe(func(v int) { got1 = append(got1, v) })
	defer unsub1()
	unsub2 := e.Subscribe(func(v int) { got2 = append(got2, v) })
	defer unsub2()

	e.Emit(1)
	e.Emit(2)

	if len(got1) != 2 || got1[0] != 1 || got1[1] != 2 {
		t.Errorf("subscriber 1 got %v, want [1 2]", got1)
	}
	if len(got2) != 2 || got2[0] != 1 || got2[1] != 2 {
		t.Errorf("subscriber 2 got %v, want [1 2]", got2)
	}
}

func TestUnsubscribeLeavesOtherWorking(t *testing.T) {
	var e notify.Emitter[int]
	var got1, got2 []int
	unsub1 := e.Subscribe(func(v int) { got1 = append(got1, v) })
	unsub2 := e.Subscribe(func(v int) { got2 = append(got2, v) })

	unsub1()
	e.Emit(1)

	if len(got1) != 0 {
		t.Errorf("unsubscribed subscriber got %v, want none", got1)
	}
	if len(got2) != 1 || got2[0] != 1 {
		t.Errorf("remaining subscriber got %v, want [1]", got2)
	}
	unsub2()
}

func TestUnsubscribeTwiceIsANoOp(t *testing.T) {
	var e notify.Emitter[int]
	unsub := e.Subscribe(func(int) {})
	unsub()
	unsub() // must not panic
}

func TestReentrantSubscribeDoesNotDeadlock(t *testing.T) {
	var e notify.Emitter[int]
	done := make(chan struct{}, 1)
	e.Subscribe(func(v int) {
		e.Subscribe(func(int) {})
		done <- struct{}{}
	})

	e.Emit(1)
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Emit deadlocked on a re-entrant Subscribe")
	}
}

func TestZeroValueEmitterIsUsable(t *testing.T) {
	var e notify.Emitter[string]
	e.Emit("no subscribers, must not panic")
}

func TestConcurrentSubscribeAndEmit(t *testing.T) {
	var e notify.Emitter[int]
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			unsub := e.Subscribe(func(int) {})
			unsub()
		}()
		go func(v int) {
			defer wg.Done()
			e.Emit(v)
		}(i)
	}
	wg.Wait()
}
