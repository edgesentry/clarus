/// 2D position or velocity vector (metres or m/s).
#[derive(Debug, Clone, PartialEq)]
pub struct Vec2 {
    pub x: f32,
    pub y: f32,
}

impl Vec2 {
    pub fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }

    pub fn length(&self) -> f32 {
        (self.x * self.x + self.y * self.y).sqrt()
    }

    pub fn normalize(&self) -> Self {
        let len = self.length();
        if len < f32::EPSILON {
            Self::new(0.0, 0.0)
        } else {
            Self::new(self.x / len, self.y / len)
        }
    }

    pub fn dot(&self, other: &Self) -> f32 {
        self.x * other.x + self.y * other.y
    }
}

impl std::ops::Sub for &Vec2 {
    type Output = Vec2;
    fn sub(self, other: &Vec2) -> Vec2 {
        Vec2::new(self.x - other.x, self.y - other.y)
    }
}

/// Physical class of an entity, used to look up braking parameters.
#[derive(Debug, Clone, PartialEq)]
pub enum EntityClass {
    /// Counterbalanced forklift up to 3.5 T
    Forklift,
    /// Reach stacker / empty container handler
    ReachStacker,
    /// Terminal tractor / yard truck
    TerminalTractor,
    /// Vessel (ship) — very slow deceleration
    Vessel,
    /// Walking person — modelled as stopping instantly (conservative)
    Person,
}

impl EntityClass {
    /// Maximum service-brake deceleration in m/s².
    /// Person returns f32::INFINITY (stops instantly — safest assumption).
    pub fn deceleration_ms2(&self) -> f32 {
        match self {
            EntityClass::Forklift => 1.5,
            EntityClass::ReachStacker => 1.0,
            EntityClass::TerminalTractor => 2.0,
            EntityClass::Vessel => 0.05,
            EntityClass::Person => f32::INFINITY,
        }
    }
}

/// A tracked entity in the physical space.
#[derive(Debug, Clone)]
pub struct Entity {
    pub id: String,
    pub class: EntityClass,
    /// Position in metres relative to site origin.
    pub position: Vec2,
    /// Velocity in m/s.
    pub velocity: Vec2,
    /// Unix timestamp in milliseconds.
    pub timestamp_ms: u64,
}
