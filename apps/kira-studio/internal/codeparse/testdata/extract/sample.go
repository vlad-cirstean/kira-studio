package sample

type Greeter interface {
	Greet() string
}

type Person struct{}

func (p Person) Greet() string {
	return helper()
}

func helper() string {
	return "hi"
}
