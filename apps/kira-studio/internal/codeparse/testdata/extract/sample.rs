trait Greeter {
    fn greet(&self, name: &str) -> String;
}

struct Person;

impl Greeter for Person {
    fn greet(&self, name: &str) -> String {
        helper(name)
    }
}

fn helper(name: &str) -> String {
    format!("hi {}", name)
}
